// THE FIX: Define the mock variable BEFORE jest.mock is called.
const mockDeleteFiles = jest.fn();

jest.mock("uploadthing/server", () => ({
    UTApi: jest.fn().mockImplementation(() => ({
        deleteFiles: mockDeleteFiles,
    })),
}));

jest.mock("@src/telemetry", () => {
    const realEvents = jest.requireActual("@src/telemetry/events").default;
    return {
        __esModule: true,
        EVENTS: realEvents,
        eventBus: { emit: jest.fn() },
    };
});

jest.mock("@src/dbClient", () => ({
    isDatabaseInitialized: jest.fn(() => true),
    query: jest.fn(),
}));

import { runCleanup } from "@src/cleanupService";
import { eventBus, EVENTS } from "@src/telemetry";
import db from "@src/dbClient";

const mockedDbQuery = db.query as jest.Mock;
const mockedEventBusEmit = eventBus.emit as jest.Mock;

describe("Cleanup Service Logic (runCleanup)", () => {
    test("Should emit COMPLETE if no old files are found", async () => {
        mockedDbQuery.mockResolvedValueOnce({ rows: [] });

        await runCleanup();

        expect(db.query).toHaveBeenCalledTimes(1);
        expect(mockDeleteFiles).not.toHaveBeenCalled();
        expect(mockedEventBusEmit).toHaveBeenCalledWith(
            EVENTS.CLEANUP.COMPLETE,
            {
                count: 0,
                message: "No files to clean",
            },
        );
    });

    test("Should emit START and COMPLETE on successful cleanup", async () => {
        const fileKeys = ["key1", "key2"];
        mockedDbQuery.mockResolvedValueOnce({
            rows: [{ file_key: "key1" }, { file_key: "key2" }],
        });
        mockDeleteFiles.mockResolvedValueOnce({ success: true });
        mockedDbQuery.mockResolvedValueOnce({ rowCount: 2 });

        await runCleanup();

        const emitCalls = mockedEventBusEmit.mock.calls;
        expect(emitCalls[0][0]).toBe(EVENTS.CLEANUP.START);
        expect(mockDeleteFiles).toHaveBeenCalledWith(fileKeys);
        expect(db.query).toHaveBeenCalledTimes(2);
        expect(emitCalls[1][0]).toBe(EVENTS.CLEANUP.COMPLETE);
        expect(emitCalls[1][1]).toEqual({ deletedCount: 2 });
    });

    test("Should emit ERROR and NOT delete from DB if UploadThing fails", async () => {
        const fileKeys = ["key1"];
        mockedDbQuery.mockResolvedValueOnce({ rows: [{ file_key: "key1" }] });
        mockDeleteFiles.mockResolvedValueOnce({
            success: false,
            error: "UT API is down",
        });

        await runCleanup();

        expect(mockDeleteFiles).toHaveBeenCalledWith(fileKeys);
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(mockedEventBusEmit).toHaveBeenCalledWith(EVENTS.CLEANUP.ERROR, {
            context: "UploadThing Deletion Failed",
            result: { success: false, error: "UT API is down" },
        });
    });
});