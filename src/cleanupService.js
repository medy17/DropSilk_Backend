// --- src/cleanupService.js ---

const { UTApi } = require("uploadthing/server");
const db = require("./dbClient");
const { eventBus, EVENTS } = require("./telemetry");

// We initialize UTApi here.
const utapi = new UTApi();

const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;

async function runCleanup() {
    // If the database is not initialized, we can't do anything.
    if (!db.isDatabaseInitialized()) {
        eventBus.emit(EVENTS.CLEANUP.SKIPPED, {
            reason: "DB not initialized",
        });
        return;
    }

    try {
        const cutOffDate = new Date(Date.now() - TWENTY_FOUR_HOURS_IN_MS);

        // 1. Find old file keys in OUR database
        const selectQuery = `SELECT file_key FROM uploaded_files WHERE uploaded_at <= $1`;
        const { rows: filesToDelete } = await db.query(selectQuery, [
            cutOffDate,
        ]);

        if (filesToDelete.length === 0) {
            eventBus.emit(EVENTS.CLEANUP.COMPLETE, {
                count: 0,
                message: "No files to clean",
            });
            return;
        }

        const fileKeys = filesToDelete.map((file) => file.file_key);
        eventBus.emit(EVENTS.CLEANUP.START, {
            count: fileKeys.length,
            keys: fileKeys,
        });

        // 2. Delete the files from UploadThing
        const deleteResult = await utapi.deleteFiles(fileKeys);

        if (!deleteResult.success) {
            eventBus.emit(EVENTS.CLEANUP.ERROR, {
                context: "UploadThing Deletion Failed",
                result: deleteResult,
            });
            return;
        }

        // 3. Delete the records from OUR database
        const deleteQuery = `DELETE FROM uploaded_files WHERE file_key = ANY($1::text[])`;
        const deleteDbResult = await db.query(deleteQuery, [fileKeys]);

        eventBus.emit(EVENTS.CLEANUP.COMPLETE, {
            deletedCount: deleteDbResult.rowCount,
        });
    } catch (error) {
        eventBus.emit(EVENTS.CLEANUP.ERROR, {
            error: error.message,
            stack: error.stack,
        });
    }
}

function startCleanupService(intervalMinutes = 15) {
    if (!db.isDatabaseInitialized()) {
        eventBus.emit(EVENTS.CLEANUP.SKIPPED, {
            reason: "Cleanup service disabled (DB not initialised/disabled).",
        });
        return;
    }

    // We log/emit that the schedule is active
    eventBus.emit(EVENTS.SYSTEM.STARTUP, {
        service: "Cleanup Service",
        interval: intervalMinutes,
    });

    runCleanup();
    setInterval(runCleanup, intervalMinutes * 60 * 1000);
}

module.exports = { startCleanupService, runCleanup };