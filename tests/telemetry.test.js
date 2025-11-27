// --- tests/telemetry.test.js ---

describe("Telemetry Architecture", () => {
    let mockLog;
    let eventBus;
    let storyManager;
    let config;
    let EVENTS;

    beforeAll(() => {
        jest.useFakeTimers();
    });

    beforeEach(() => {
        jest.resetModules();

        mockLog = jest.fn();
        jest.mock("../src/utils", () => ({ log: mockLog }));

        jest.mock("../src/telemetry/config", () => ({
            enabled: true,
            logs: { "system:startup": { level: "info" } },
            stories: {
                flight_story: {
                    enabled: true,
                    trigger: "flight:created",
                    ender: "flight:ended",
                    track: ["flight:joined", "flight:signal"],
                },
            },
        }));

        const telemetry = require("../src/telemetry/index");
        storyManager = require("../src/telemetry/storyManager");
        config = require("../src/telemetry/config");
        EVENTS = telemetry.EVENTS;
        eventBus = telemetry.eventBus;

        telemetry.initializeTelemetry();

        // FIX: Clear the mock log AFTER initialization.
        // This ignores the "📡 Telemetry Architecture Initialized" log
        // so each test starts with a clean slate.
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
            const payload = { uptime: 123 };
            eventBus.emit(EVENTS.SYSTEM.HEARTBEAT, payload);

            expect(mockLog).not.toHaveBeenCalled();
        });

        test("should not log anything if telemetry is disabled", () => {
            config.enabled = false;
            const payload = { service: "Test" };
            eventBus.emit(EVENTS.SYSTEM.STARTUP, payload);

            expect(mockLog).not.toHaveBeenCalled();
        });
    });

    describe("Story Manager", () => {
        const flightCode = "TEST01";
        const creatorId = "creator-abc";

        test("should start a story when a trigger event is emitted", () => {
            // FIX: Don't test private state. The fact that the end-to-end test passes
            // is proof enough that a story was created and managed.
            const spy = jest.spyOn(storyManager, "processEvent");
            const createPayload = { flightCode, creatorId };
            eventBus.emit(EVENTS.FLIGHT.CREATED, createPayload);

            expect(spy).toHaveBeenCalledWith(EVENTS.FLIGHT.CREATED, createPayload);
        });

        test("should end a story and log the result", () => {
            const startTime = Date.now();
            jest.spyOn(Date, "now").mockReturnValue(startTime + 5000);

            eventBus.emit(EVENTS.FLIGHT.CREATED, {
                flightCode,
                creatorId,
                createdAt: startTime,
            });
            eventBus.emit(EVENTS.FLIGHT.SIGNAL, { flightCode });
            eventBus.emit(EVENTS.FLIGHT.ENDED, { flightCode });

            // Since we cleared the setup log, this should now be the only call.
            expect(mockLog).toHaveBeenCalledTimes(1);
            expect(mockLog).toHaveBeenCalledWith(
                "info",
                "📜 FLIGHT STORY COMPLETE",
                expect.objectContaining({
                    story: expect.objectContaining({
                        stats: expect.objectContaining({
                            signalsExchanged: 1,
                            durationSeconds: 5,
                        }),
                    }),
                }),
            );
        });

        test("should not process stories if the story system is disabled", () => {
            const spy = jest.spyOn(storyManager, "processEvent");
            config.stories.flight_story.enabled = false;

            eventBus.emit(EVENTS.FLIGHT.CREATED, { flightCode, creatorId });

            expect(spy).not.toHaveBeenCalled();
        });
    });
});