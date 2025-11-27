// --- tests/telemetry.storyManager.test.ts ---

import storyManager from "@src/telemetry/storyManager";
import eventBus from "@src/telemetry/eventBus";
import { log } from "@src/utils";
// @ts-ignore
import type { Story, TelemetryConfig } from "@src/telemetry/config";

jest.mock("@src/utils", () => ({ log: jest.fn() }));
jest.mock("@src/telemetry/eventBus", () => ({
    on: jest.fn(),
    emit: jest.fn(),
}));

const mockLog = log as jest.Mock;
const mockEventBusOn = eventBus.on as jest.Mock;

describe("Unit Tests for StoryManager", () => {
    const flightCode = "ABC123";
    const clientId = "client-xyz-987";

    const mockStoryConfig: TelemetryConfig["stories"] = {
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
                    handler: (story, payload) =>
                        story.timeline.push("disconnected"),
                },
            },
            create: (payload): Story => ({
                meta: {
                    flightCode: payload.flightCode,
                    startTime: new Date(payload.createdAt).toISOString(),
                },
                participants: [],
                timeline: [],
                stats: { signals: 0 },
            }),
        },
        session_story: {
            enabled: true,
            contextKey: "clientId",
            trigger: "client:connected",
            ender: ["client:disconnected"],
            track: {},
            create: (payload): Story => ({
                meta: {
                    clientId: payload.clientId,
                    startTime: new Date().toISOString(),
                },
                participants: [],
                timeline: [],
                stats: {},
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
            create: (payload): Story => ({
                meta: { bugId: payload.bugId },
                participants: [],
                timeline: [],
                stats: {},
            }),
        },
    };

    afterEach(() => {
        storyManager.teardown();
        mockLog.mockClear();
    });

    describe("Initialization", () => {
        it("should attach listeners for all enabled stories", () => {
            storyManager.initialize({
                flight_story: mockStoryConfig.flight_story,
                session_story: mockStoryConfig.session_story,
            });
            expect(mockEventBusOn).toHaveBeenCalledTimes(6);
        });
    });

    const manager = storyManager as any;

    describe("Story Lifecycle", () => {
        it("should start a story when a trigger event is received", () => {
            manager.initialize({ flight_story: mockStoryConfig.flight_story });
            mockLog.mockClear(); // THE FIX: Clear after initialization

            const payload = { flightCode, createdAt: Date.now() };
            manager.startStory(
                manager.storyTrackers.get("flight_story"),
                payload,
            );
            const story = manager.storyTrackers
                .get("flight_story")
                .activeStories.get(flightCode);
            expect(story).toBeDefined();
        });

        it("should end and log a story when an ender event is received", () => {
            manager.initialize({ flight_story: mockStoryConfig.flight_story });
            const tracker = manager.storyTrackers.get("flight_story");
            manager.startStory(tracker, {
                flightCode,
                createdAt: Date.now(),
            });
            mockLog.mockClear(); // THE FIX: Clear before the action we're testing

            manager.endStory(tracker, { flightCode }, "clean_end");
            expect(tracker.activeStories.has(flightCode)).toBe(false);
            expect(mockLog).toHaveBeenCalledTimes(1);
        });
    });

    describe("Robustness and Edge Cases", () => {
        beforeEach(() => {
            manager.initialize(mockStoryConfig);
            mockLog.mockClear(); // THE FIX: Clear after initialization
        });

        it("should ignore update/ender events for non-existent stories", () => {
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

        it("should ignore events with missing context keys", () => {
            const tracker = manager.storyTrackers.get("flight_story");
            manager.startStory(tracker, {
                flightCode,
                createdAt: Date.now(),
            });
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
        });

        it("should catch and log errors from a buggy handler without crashing", () => {
            const bugTracker = manager.storyTrackers.get("buggy_story");
            const bugId = "BUG-001";
            manager.startStory(bugTracker, { bugId });

            mockLog.mockClear(); // THE FIX: Clear before the action

            const action = () =>
                manager.updateStory(
                    bugTracker,
                    { bugId },
                    bugTracker.config.track["bug:event"],
                );

            expect(action).not.toThrow();

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