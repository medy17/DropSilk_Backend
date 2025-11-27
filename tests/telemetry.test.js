// --- tests/telemetry.test.js ---

describe("Telemetry Architecture", () => {
    // These will be populated in beforeEach
    let mockLog;
    let eventBus;
    let config;
    let EVENTS;
    let telemetry;

    // We use fake timers to control time-based logic like story duration
    beforeAll(() => {
        jest.useFakeTimers();
    });

    // This setup runs before EACH test to ensure a clean slate
    beforeEach(() => {
        // This is CRITICAL. It clears the module cache, so our mocks
        // are fresh every single time. Without this, our singleton eventBus
        // would keep its listeners from previous tests.
        jest.resetModules();

        // 1. Mock the logger so we can spy on its output
        mockLog = jest.fn();
        jest.mock("../src/utils", () => ({ log: mockLog }));

        // 2. Mock the config with our new, smarter story definition
        jest.mock("../src/telemetry/config", () => ({
            enabled: true,
            logs: { "system:startup": { level: "info" } },
            stories: {
                flight_story: {
                    enabled: true,
                    contextKey: "flightCode",
                    trigger: "flight:created",
                    ender: ["flight:ended"],
                    track: {
                        "flight:joined": {
                            handler: (story, payload) => {
                                story.participants.push({ id: payload.joinerId });
                            },
                        },
                        "flight:signal": {
                            handler: (story, payload) => {
                                story.stats.signalsExchanged++;
                            },
                        },
                    },
                    create: (payload) => ({
                        meta: {
                            flightCode: payload.flightCode,
                            startTime: new Date(
                                payload.createdAt || Date.now(),
                            ).toISOString(),
                        },
                        participants: [],
                        stats: {
                            signalsExchanged: 0,
                            durationSeconds: 0,
                        },
                    }),
                },
            },
        }));

        // 3. NOW that mocks are in place, we can require the modules
        telemetry = require("../src/telemetry/index");
        config = require("../src/telemetry/config");
        EVENTS = telemetry.EVENTS;
        eventBus = telemetry.eventBus;

        // 4. Initialize the system. This sets up all the listeners.
        telemetry.initializeTelemetry();

        // 5. Clear the mock log to ignore the "Initialized" log message.
        // This way, our tests only care about what happens AFTER setup.
        mockLog.mockClear();
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    describe("Direct Logging", () => {
        test("should call the logger for an event listed in config.logs", () => {
            const payload = { service: "Test" };
            eventBus.emit(EVENTS.SYSTEM.STARTUP, payload);

            expect(mockLog).toHaveBeenCalledTimes(1);
            expect(mockLog).toHaveBeenCalledWith("info", "system:startup", payload);
        });

        test("should NOT call the logger for an event not in config.logs", () => {
            eventBus.emit(EVENTS.SYSTEM.HEARTBEAT, { uptime: 123 });
            expect(mockLog).not.toHaveBeenCalled();
        });
    });

    describe("Story Engine", () => {
        const flightCode = "TEST01";
        const creatorId = "creator-abc";
        const joinerId = "joiner-xyz";

        test("end-to-end flight story should be created, updated, and logged on completion", () => {
            const startTime = Date.now();
            // We advance the time by 5 seconds to test the duration calculation
            jest.advanceTimersByTime(5000);

            // --- ACT ---
            // We simulate a real sequence of events for a single flight
            eventBus.emit(EVENTS.FLIGHT.CREATED, {
                flightCode,
                creatorId,
                createdAt: startTime,
            });
            eventBus.emit(EVENTS.FLIGHT.JOINED, { flightCode, joinerId });
            eventBus.emit(EVENTS.FLIGHT.SIGNAL, { flightCode });
            eventBus.emit(EVENTS.FLIGHT.SIGNAL, { flightCode }); // A second signal
            eventBus.emit(EVENTS.FLIGHT.ENDED, { flightCode });

            // --- ASSERT ---
            // The only log we expect is the final story summary.
            expect(mockLog).toHaveBeenCalledTimes(1);
            expect(mockLog).toHaveBeenCalledWith(
                "info",
                "📜 STORY COMPLETE: flight_story",
                expect.objectContaining({
                    story: expect.objectContaining({
                        // Check metadata
                        meta: expect.objectContaining({
                            flightCode: flightCode,
                            endReason: "clean_end",
                        }),
                        // Check aggregated data
                        participants: [{ id: joinerId }],
                        stats: expect.objectContaining({
                            signalsExchanged: 2,
                            durationSeconds: 5, // <-- This confirms our timer mock worked
                        }),
                    }),
                }),
            );
        });

        test("should not log a story if the story is disabled in config", () => {
            // --- ARRANGE ---
            // We need to modify the config and re-initialize for this test case
            jest.resetModules();
            // FIX: The variable name MUST start with "mock" for Jest hoisting to work.
            const mockDisabledLog = jest.fn();
            jest.mock("../src/utils", () => ({ log: mockDisabledLog }));
            jest.mock("../src/telemetry/config", () => ({
                enabled: true,
                logs: {},
                stories: {
                    flight_story: {
                        enabled: false, // <-- The key change
                        trigger: "flight:created",
                    },
                },
            }));

            const localTelemetry = require("../src/telemetry/index");
            const localEventBus = localTelemetry.eventBus;
            localTelemetry.initializeTelemetry();
            mockDisabledLog.mockClear();

            // --- ACT ---
            localEventBus.emit(EVENTS.FLIGHT.CREATED, { flightCode });
            localEventBus.emit(EVENTS.FLIGHT.ENDED, { flightCode });

            // --- ASSERT ---
            // We expect NO "STORY COMPLETE" logs at all.
            expect(mockDisabledLog).not.toHaveBeenCalledWith(
                expect.stringContaining("STORY COMPLETE"),
                expect.anything(),
            );
        });
    });
});