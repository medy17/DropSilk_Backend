// --- tests/telemetry.storyManager.test.js ---

// 1. Mock dependencies FIRST
const mockLog = jest.fn();
const mockEventBus = {
    on: jest.fn(),
    emit: jest.fn(),
};
jest.mock("../src/utils", () => ({ log: mockLog }));
jest.mock("../src/telemetry/eventBus", () => mockEventBus);

// 2. Now import the module we are testing
const StoryManager = require("../src/telemetry/storyManager");

describe("Unit Tests for StoryManager", () => {
    let manager;
    const flightCode = "ABC123";
    const clientId = "client-xyz-987";

    // An expanded mock config for advanced tests
    const mockStoryConfig = {
        flight_story: {
            enabled: true,
            contextKey: "flightCode",
            trigger: "flight:created",
            ender: ["flight:ended"],
            track: {
                "flight:signal": {
                    handler: (story, payload) => story.stats.signals++,
                },
                "client:disconnected": {
                    mapToContext: "flightCode",
                    handler: (story, payload) => story.timeline.push("disconnected"),
                },
            },
            create: (payload) => ({
                meta: {
                    flightCode: payload.flightCode,
                    startTime: new Date(payload.createdAt).toISOString(),
                },
                stats: { signals: 0 },
                timeline: [],
            }),
        },
        session_story: {
            enabled: true,
            contextKey: "clientId",
            trigger: "client:connected",
            ender: ["client:disconnected"],
            track: {},
            // FIX: The original test config was the source of the bug.
            // Even though the code is now robust, a good test should still
            // provide valid data structures.
            create: (payload) => ({
                meta: {
                    clientId: payload.clientId,
                    startTime: new Date().toISOString(),
                },
                // This story doesn't need stats, so we can omit it,
                // and our hardened endStory function won't crash.
            }),
        },
        buggy_story: {
            enabled: true,
            contextKey: "bugId",
            trigger: "bug:created",
            ender: [],
            track: {
                "bug:event": {
                    handler: () => {
                        throw new Error("This handler is fucked");
                    },
                },
            },
            create: (payload) => ({ meta: { bugId: payload.bugId } }),
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        manager = new StoryManager.constructor();
    });

    // FIX: Add an afterEach to clean up the setInterval timer
    afterEach(() => {
        manager.teardown();
    });

    describe("Initialization", () => {
        it("should attach listeners for all enabled stories", () => {
            manager.initialize({
                flight_story: mockStoryConfig.flight_story,
                session_story: mockStoryConfig.session_story,
            });
            expect(mockEventBus.on).toHaveBeenCalledTimes(6);
        });
    });

    describe("Story Lifecycle", () => {
        it("should start a story when a trigger event is received", () => {
            manager.initialize({ flight_story: mockStoryConfig.flight_story });
            const payload = { flightCode, createdAt: Date.now() };
            manager.startStory(manager.storyTrackers.get("flight_story"), payload);
            const story = manager.storyTrackers
                .get("flight_story")
                .activeStories.get(flightCode);
            expect(story).toBeDefined();
        });

        it("should end and log a story when an ender event is received", () => {
            manager.initialize({ flight_story: mockStoryConfig.flight_story });
            const tracker = manager.storyTrackers.get("flight_story");
            manager.startStory(tracker, { flightCode, createdAt: Date.now() });
            mockLog.mockClear();
            manager.endStory(tracker, { flightCode }, "clean_end");
            expect(tracker.activeStories.has(flightCode)).toBe(false);
            expect(mockLog).toHaveBeenCalledTimes(1);
        });
    });

    describe("Robustness and Edge Cases", () => {
        beforeEach(() => {
            manager.initialize(mockStoryConfig);
            mockLog.mockClear();
        });

        it("should ignore update/ender events for non-existent stories (Ghost Events)", () => {
            const tracker = manager.storyTrackers.get("flight_story");
            manager.updateStory(
                tracker,
                { flightCode: "GHOST1" },
                tracker.config.track["flight:signal"],
            );
            manager.endStory(tracker, { flightCode: "GHOST1" }, "clean_end");
            expect(tracker.activeStories.size).toBe(0);
            expect(mockLog).not.toHaveBeenCalled();
        });

        it("should ignore events with missing context keys (Dodgy Payloads)", () => {
            const tracker = manager.storyTrackers.get("flight_story");
            manager.startStory(tracker, { flightCode, createdAt: Date.now() });
            const story = tracker.activeStories.get(flightCode);
            manager.updateStory(
                tracker,
                { flightCode: null },
                tracker.config.track["flight:signal"],
            );
            manager.updateStory(
                tracker,
                { someOtherProp: "foo" },
                tracker.config.track["flight:signal"],
            );
            expect(story.stats.signals).toBe(0);
            expect(mockLog).not.toHaveBeenCalled();
        });

        it("should not allow one story's events to affect another (Crossed Wires)", () => {
            const flightTracker = manager.storyTrackers.get("flight_story");
            const sessionTracker = manager.storyTrackers.get("session_story");
            manager.startStory(flightTracker, {
                flightCode,
                createdAt: Date.now(),
            });
            manager.startStory(sessionTracker, { clientId });
            expect(flightTracker.activeStories.has(flightCode)).toBe(true);
            expect(sessionTracker.activeStories.has(clientId)).toBe(true);

            const signalPayload = { flightCode };
            manager.updateStory(
                flightTracker,
                signalPayload,
                flightTracker.config.track["flight:signal"],
            );

            const flightStory = flightTracker.activeStories.get(flightCode);
            expect(flightStory.stats.signals).toBe(1);

            manager.endStory(sessionTracker, { clientId }, "clean_end");
            expect(sessionTracker.activeStories.has(clientId)).toBe(false);
            expect(flightTracker.activeStories.has(flightCode)).toBe(true);
        });

        it("should catch and log errors from a buggy handler without crashing", () => {
            const bugTracker = manager.storyTrackers.get("buggy_story");
            const bugId = "BUG-001";
            manager.startStory(bugTracker, { bugId });

            const action = () =>
                manager.updateStory(
                    bugTracker,
                    { bugId },
                    bugTracker.config.track["bug:event"],
                );

            expect(action).not.toThrow();

            expect(mockLog).toHaveBeenCalledTimes(1);
            expect(mockLog).toHaveBeenCalledWith(
                "error",
                "Error in story handler",
                expect.objectContaining({
                    storyName: "buggy_story",
                    contextId: bugId,
                    error: "This handler is fucked",
                }),
            );
        });
    });
});