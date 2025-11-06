// --- src/cleanupService.js ---

const { UTApi } = require("uploadthing/server");
const { log } = require("./utils");
const db = require("./dbClient");
const config = require("./config");

// We initialize UTApi here. It will automatically look for the
// UPLOADTHING_TOKEN environment variable.
const utapi = new UTApi();

const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;

async function runCleanup() {
    // If the database is not initialized, we can't do anything.
    if (!db.isDatabaseInitialized()) {
        log("info", "🧹 DB not initialized, skipping cleanup service run.");
        return;
    }

    log("info", "🧹 Starting cleanup service run...");

    try {
        const cutOffDate = new Date(Date.now() - TWENTY_FOUR_HOURS_IN_MS);

        // 1. Find old file keys in OUR database
        const selectQuery = `SELECT file_key FROM uploaded_files WHERE uploaded_at <= $1`;
        const { rows: filesToDelete } = await db.query(selectQuery, [
            cutOffDate,
        ]);

        if (filesToDelete.length === 0) {
            log("info", "🧹 No old files to delete. All clean!");
            return;
        }

        const fileKeys = filesToDelete.map((file) => file.file_key);
        log("info", `🧹 Found ${fileKeys.length} files to delete.`, {
            keys: fileKeys,
        });

        // 2. Delete the files from UploadThing
        const deleteResult = await utapi.deleteFiles(fileKeys);

        // The UTApi returns { success: boolean }
        if (!deleteResult.success) {
            log(
                "error",
                "🚨 Failed to delete files from UploadThing API",
                { result: deleteResult }, // Log the actual result from the API
            );
            // Don't proceed to delete from DB if this crucial step fails
            return;
        }
        log("info", "✅ Successfully deleted files from UploadThing.");

        // 3. Delete the records from OUR database
        const deleteQuery = `DELETE FROM uploaded_files WHERE file_key = ANY($1::text[])`;
        const deleteDbResult = await db.query(deleteQuery, [fileKeys]);

        log(
            "info",
            `✅ Successfully removed ${deleteDbResult.rowCount} records from the database.`,
        );
    } catch (error) {
        log("error", "🚨 An error occurred during the cleanup process", {
            error: error.message,
            stack: error.stack,
        });
    } finally {
        log("info", "🧹 Cleanup service run finished.");
    }
}

function startCleanupService(intervalMinutes = 15) {
    if (!db.isDatabaseInitialized()) {
        log(
            "info",
            "🧹 Cleanup service disabled (DB not initialised/disabled).",
        );
        return;
    }
    log(
        "info",
        `🕒 Cleanup service scheduled to run every ${intervalMinutes} minutes.`,
    );
    // Run once on start to catch any old files, then set the interval
    runCleanup();
    setInterval(runCleanup, intervalMinutes * 60 * 1000);
}

module.exports = { startCleanupService };