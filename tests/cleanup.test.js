// tests/cleanup.test.js

// 1. Mock Dependencies
jest.mock('../src/config', () => ({
    // No specific config needed for logic test, but good practice
    NO_DB: false
}));

jest.mock('../src/utils', () => ({
    log: jest.fn()
}));

// 2. Mock Database
const mockQuery = jest.fn();
jest.mock('../src/dbClient', () => ({
    isDatabaseInitialized: jest.fn(() => true),
    query: mockQuery
}));

// 3. Mock UploadThing
const mockDeleteFiles = jest.fn();
jest.mock('uploadthing/server', () => {
    return {
        UTApi: jest.fn().mockImplementation(() => ({
            deleteFiles: mockDeleteFiles
        }))
    };
});

const { startCleanupService } = require('../src/cleanupService');

// We need to access the non-exported runCleanup function usually,
// but since your file exports startCleanupService which calls runCleanup immediately,
// we can test it by invoking startCleanupService and manipulating timers.
// HOWEVER, a cleaner way for testing is to extract the logic or rely on the immediate call.
// For this test, we will rely on the fact that startCleanupService calls runCleanup() once immediately.

describe('Cleanup Service', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('Should do nothing if no old files are found', async () => {
        // Mock DB returning empty list
        mockQuery.mockResolvedValueOnce({ rows: [] });

        // Start the service
        startCleanupService(60);

        // Wait for promises to resolve (startCleanupService triggers an async function)
        await Promise.resolve();
        await Promise.resolve();

        expect(mockQuery).toHaveBeenCalledTimes(1); // The select query
        expect(mockDeleteFiles).not.toHaveBeenCalled(); // Should not try to delete
    });

    test('Should delete files from UploadThing AND Database if old files exist', async () => {
        // 1. Mock DB returning 2 old files
        mockQuery.mockResolvedValueOnce({
            rows: [
                { file_key: 'key1' },
                { file_key: 'key2' }
            ]
        });

        // 2. Mock UploadThing deletion success
        mockDeleteFiles.mockResolvedValueOnce({ success: true });

        // 3. Mock DB deletion success (for the second query)
        mockQuery.mockResolvedValueOnce({ rowCount: 2 });

        startCleanupService(60);

        // Allow async loop to process
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Check Step 1: Select
        expect(mockQuery).toHaveBeenNthCalledWith(1,
            expect.stringContaining('SELECT file_key FROM uploaded_files'),
            expect.any(Array)
        );

        // Check Step 2: UploadThing Delete
        expect(mockDeleteFiles).toHaveBeenCalledWith(['key1', 'key2']);

        // Check Step 3: DB Delete
        expect(mockQuery).toHaveBeenNthCalledWith(2,
            expect.stringContaining('DELETE FROM uploaded_files'),
            [['key1', 'key2']]
        );
    });

    test('Should NOT delete from DB if UploadThing deletion fails', async () => {
        // 1. Mock DB returning 1 old file
        mockQuery.mockResolvedValueOnce({ rows: [{ file_key: 'key1' }] });

        // 2. Mock UploadThing deletion FAILURE
        mockDeleteFiles.mockResolvedValueOnce({ success: false });

        startCleanupService(60);

        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // It should have tried to delete from UT
        expect(mockDeleteFiles).toHaveBeenCalled();

        // But it should NOT have called the delete query on the DB
        // (We expect 1 call total: the SELECT)
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });
});