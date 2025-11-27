// --- tests/cleanup.test.js ---

const mockDeleteFiles = jest.fn();

jest.mock("uploadthing/server", () => ({
    UTApi: jest.fn().mockImplementation(() => ({
        deleteFiles: mockDeleteFiles,
    })),
}));

jest.mock("../src/telemetry", () => ({
    EVENTS: jest.requireActual("../src/telemetry/events"),
    eventBus: { emit: jest.fn() },
}));

jest.mock("../src/dbClient", () => ({
    isDatabaseInitialized: jest.fn(() => true),
    query: jest.fn(),
}));

// Import runCleanup directly to make tests synchronous and predictable.
const { runCleanup } = require("../src/cleanupService");
const { eventBus, EVENTS } = require("../src/telemetry");
const db = require("../src/dbClient");

describe("Cleanup Service Logic (runCleanup)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("Should emit COMPLETE if no old files are found", async () => {
        db.query.mockResolvedValueOnce({ rows: [] });

        await runCleanup();

        expect(db.query).toHaveBeenCalledTimes(1);
        expect(mockDeleteFiles).not.toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith(EVENTS.CLEANUP.COMPLETE, {
            count: 0,
            message: "No files to clean",
        });
    });

    test("Should emit START and COMPLETE on successful cleanup", async () => {
        const fileKeys = ["key1", "key2"];
        db.query.mockResolvedValueOnce({
            rows: [{ file_key: "key1" }, { file_key: "key2" }],
        });
        mockDeleteFiles.mockResolvedValueOnce({ success: true });
        db.query.mockResolvedValueOnce({ rowCount: 2 });

        await runCleanup();

        // Check the sequence of calls
        const emitCalls = eventBus.emit.mock.calls;
        expect(emitCalls[0][0]).toBe(EVENTS.CLEANUP.START);
        expect(mockDeleteFiles).toHaveBeenCalledWith(fileKeys);
        expect(db.query).toHaveBeenCalledTimes(2);
        expect(emitCalls[1][0]).toBe(EVENTS.CLEANUP.COMPLETE);
        expect(emitCalls[1][1]).toEqual({ deletedCount: 2 });
    });

    test("Should emit ERROR and NOT delete from DB if UploadThing fails", async () => {
        const fileKeys = ["key1"];
        db.query.mockResolvedValueOnce({ rows: [{ file_key: "key1" }] });
        mockDeleteFiles.mockResolvedValueOnce({
            success: false,
            error: "UT API is down",
        });

        await runCleanup();

        expect(mockDeleteFiles).toHaveBeenCalledWith(fileKeys);
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(eventBus.emit).toHaveBeenCalledWith(EVENTS.CLEANUP.ERROR, {
            context: "UploadThing Deletion Failed",
            result: { success: false, error: "UT API is down" },
        });
    });
});