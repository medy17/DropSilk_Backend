// --- src/cleanupService.ts ---

import { UTApi } from "uploadthing/server";
import db from "./dbClient";
import { eventBus, EVENTS } from "./telemetry";

const utapi = new UTApi();

const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;

export async function runCleanup() {
    if (!db.isDatabaseInitialized()) {
        eventBus.emit(EVENTS.CLEANUP.SKIPPED, {
            reason: "DB not initialized",
        });
        return;
    }

    try {
        const cutOffDate = new Date(Date.now() - TWENTY_FOUR_HOURS_IN_MS);

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

        const deleteResult = await utapi.deleteFiles(fileKeys);

        if (!deleteResult.success) {
            eventBus.emit(EVENTS.CLEANUP.ERROR, {
                context: "UploadThing Deletion Failed",
                result: deleteResult,
            });
            return;
        }

        const deleteQuery = `DELETE FROM uploaded_files WHERE file_key = ANY($1::text[])`;
        const deleteDbResult = await db.query(deleteQuery, [fileKeys]);

        eventBus.emit(EVENTS.CLEANUP.COMPLETE, {
            deletedCount: deleteDbResult.rowCount,
        });
    } catch (error: any) {
        eventBus.emit(EVENTS.CLEANUP.ERROR, {
            error: error.message,
            stack: error.stack,
        });
    }
}

export function startCleanupService(intervalMinutes = 15) {
    if (!db.isDatabaseInitialized()) {
        eventBus.emit(EVENTS.CLEANUP.SKIPPED, {
            reason: "Cleanup service disabled (DB not initialised/disabled).",
        });
        return;
    }

    eventBus.emit(EVENTS.SYSTEM.STARTUP, {
        service: "Cleanup Service",
        interval: intervalMinutes,
    });

    runCleanup();
    setInterval(runCleanup, intervalMinutes * 60 * 1000);
}

// NOTE: We no longer have the module.exports line at the bottom