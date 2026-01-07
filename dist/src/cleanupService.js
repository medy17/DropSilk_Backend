"use strict";
// --- src/cleanupService.ts ---
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCleanup = runCleanup;
exports.startCleanupService = startCleanupService;
const server_1 = require("uploadthing/server");
const db = __importStar(require("./dbClient"));
const gossamer_1 = require("./gossamer");
// We initialize UTApi here.
const utapi = new server_1.UTApi();
const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;
async function runCleanup() {
    // If the database is not initialized, we can't do anything.
    if (!db.isDatabaseInitialized()) {
        (0, gossamer_1.emit)("cleanup:skipped", {
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
            (0, gossamer_1.emit)("cleanup:complete", {
                count: 0,
                message: "No files to clean",
            });
            return;
        }
        const fileKeys = filesToDelete.map((file) => file.file_key);
        (0, gossamer_1.emit)("cleanup:start", {
            count: fileKeys.length,
            keys: fileKeys,
        });
        // 2. Delete the files from UploadThing
        const deleteResult = await utapi.deleteFiles(fileKeys);
        if (!deleteResult.success) {
            (0, gossamer_1.emit)("cleanup:error", {
                context: "UploadThing Deletion Failed",
                result: deleteResult,
            });
            return;
        }
        // 3. Delete the records from OUR database
        const deleteQuery = `DELETE FROM uploaded_files WHERE file_key = ANY($1::text[])`;
        const deleteDbResult = await db.query(deleteQuery, [fileKeys]);
        (0, gossamer_1.emit)("cleanup:complete", {
            deletedCount: deleteDbResult.rowCount,
        });
    }
    catch (error) {
        const err = error;
        (0, gossamer_1.emit)("cleanup:error", {
            error: err.message,
            stack: err.stack,
        });
    }
}
function startCleanupService(intervalMinutes = 15) {
    if (!db.isDatabaseInitialized()) {
        (0, gossamer_1.emit)("cleanup:skipped", {
            reason: "Cleanup service disabled (DB not initialised/disabled).",
        });
        return;
    }
    // We log/emit that the schedule is active
    (0, gossamer_1.emit)("system:startup", {
        service: "Cleanup Service",
        interval: intervalMinutes,
    });
    runCleanup();
    setInterval(runCleanup, intervalMinutes * 60 * 1000);
}
//# sourceMappingURL=cleanupService.js.map