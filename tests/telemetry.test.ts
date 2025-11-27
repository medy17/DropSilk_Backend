// --- tests/telemetry.test.ts ---

import { log } from "@src/utils";
// We need to do some jest magic to test a singleton module properly
let initializeTelemetry: any, eventBus: any, EVENTS: any;

describe("Telemetry Architecture", () => {
    const mockLog = jest.fn();

    beforeAll(() => {
        jest.useFakeTimers();
    });

    beforeEach(() => {
        // Reset modules to get a fresh instance of the event bus each time
        jest.resetModules();

        // Mock dependencies BEFORE importing the module under test
        jest.mock("@src/utils", () => ({ log: mockLog }));
        jest.mock("@src/telemetry/config", () => ({
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
                            handler: (story: any, payload: any) => {
                                story.participants.push({ id: payload.joinerId });
                            },
                        },
                        "flight:signal": {
                            handler: (story: any) => {
                                story.stats.signalsExchanged++;
                            },
                        },
                    },
                    create: (payload: any) => ({
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

        // Now import the module
        const telemetry = require("@src/telemetry/index");
        initializeTelemetry = telemetry.initializeTelemetry;
        eventBus = telemetry.eventBus;
        EVENTS = telemetry.EVENTS;

        // Initialize the system for each test
        initializeTelemetry();
        mockLog.mockClear(); // Ignore the "Initialized" log
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    describe("Direct Logging", () => {
        test("should call the logger for an event listed in config.logs", () => {
            const payload = { service: "Test" };
            eventBus.emit(EVENTS.SYSTEM.STARTUP, payload);

            expect(mockLog).toHaveBeenCalledTimes(1);
            expect(mockLog).toHaveBeenCalledWith(
                "info",
                "system:startup",
                payload,
            );
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
            jest.advanceTimersByTime(5000);

            eventBus.emit(EVENTS.FLIGHT.CREATED, {
                flightCode,
                creatorId,
                createdAt: startTime,
            });
            eventBus.emit(EVENTS.FLIGHT.JOINED, { flightCode, joinerId });
            eventBus.emit(EVENTS.FLIGHT.SIGNAL, { flightCode });
            eventBus.emit(EVENTS.FLIGHT.SIGNAL, { flightCode });
            eventBus.emit(EVENTS.FLIGHT.ENDED, { flightCode });

            expect(mockLog).toHaveBeenCalledTimes(1);
            expect(mockLog).toHaveBeenCalledWith(
                "info",
                "📜 STORY COMPLETE: flight_story",
                expect.objectContaining({
                    story: expect.objectContaining({
                        meta: expect.objectContaining({
                            flightCode: flightCode,
                            endReason: "clean_end",
                        }),
                        participants: [{ id: joinerId }],
                        stats: expect.objectContaining({
                            signalsExchanged: 2,
                            durationSeconds: 5,
                        }),
                    }),
                }),
            );
        });

        test("should not log a story if the story is disabled in config", () => {
            jest.resetModules();
            const mockDisabledLog = jest.fn();
            jest.mock("@src/utils", () => ({ log: mockDisabledLog }));
            jest.mock("@src/telemetry/config", () => ({
                enabled: true,
                logs: {},
                stories: {
                    flight_story: {
                        enabled: false,
                        trigger: "flight:created",
                        ender: ["flight:ended"],
                        track: {},
                        create: () => ({}),
                    },
                },
            }));

            const localTelemetry = require("@src/telemetry/index");
            localTelemetry.initializeTelemetry();
            mockDisabledLog.mockClear();

            localTelemetry.eventBus.emit(EVENTS.FLIGHT.CREATED, { flightCode });
            localTelemetry.eventBus.emit(EVENTS.FLIGHT.ENDED, { flightCode });

            expect(mockDisabledLog).not.toHaveBeenCalledWith(
                expect.stringContaining("STORY COMPLETE"),
                expect.anything(),
            );
        });
    });
});