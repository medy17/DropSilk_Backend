// --- src/cleanupService.js ---
// This service will handle the logic for deleting old files from UploadThing.

const { UTApi } = require("uploadthing/server");
const { log } = require("./utils");

// The UTApi class automatically uses the UPLOADTHING_SECRET environment variable.
const utapi = new UTApi();

const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Finds and deletes all files from UploadThing that are older than 24 hours.
 */
async function deleteOldFiles() {
    log("info", "[Cleanup] Starting job to delete old files...");

    try {
        // 1. List all files in your UploadThing app.
        const allFiles = await utapi.listFiles({});
        const now = Date.now();

        log("info", `[Cleanup] Found ${allFiles.length} total files. Checking for old files...`);

        // 2. Filter for files that are older than one day.
        const filesToDelete = allFiles.filter(file => {
            const fileAge = now - new Date(file.createdAt).getTime();
            return fileAge > ONE_DAY_IN_MS;
        });

        if (filesToDelete.length === 0) {
            log("info", "[Cleanup] No old files to delete. Job finished.");
            return;
        }

        // 3. Extract the keys of the files to be deleted.
        const fileKeys = filesToDelete.map(file => file.key);
        log("warn", `[Cleanup] Found ${fileKeys.length} files to delete.`, { keys: fileKeys });

        // 4. Delete the files in a single batch.
        const deleteResult = await utapi.deleteFiles(fileKeys);

        if (deleteResult.success) {
            log("info", `[Cleanup] Successfully deleted ${fileKeys.length} old files. Job finished.`);
        } else {
            log("error", "[Cleanup] Failed to delete old files.", { response: deleteResult });
        }
    } catch (error) {
        log("error", "[Cleanup] A critical error occurred during the cleanup job.", {
            error: error.message,
            stack: error.stack
        });
    }
}

module.exports = {
    deleteOldFiles,
};