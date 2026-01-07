"use strict";
// --- src/dbClient.ts ---
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeDatabase = initializeDatabase;
exports.query = query;
exports.isDatabaseInitialized = isDatabaseInitialized;
const pg_1 = require("pg");
const config_1 = __importDefault(require("./config"));
let pool;
let dbInitialized = false;
// Helper for early-stage logging (before Gossamer is initialized)
const earlyLog = (level, message, meta = {}) => {
    console.log(JSON.stringify({ level: level.toUpperCase(), message, ...meta }));
};
// Honour --noDB / NO_DB
if (config_1.default.NO_DB) {
    earlyLog("info", "🛑 Database disabled via --noDB/NO_DB. Skipping DB initialisation.");
    dbInitialized = false;
}
else if (process.env.DATABASE_URL) {
    try {
        pool = new pg_1.Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false,
            },
        });
        earlyLog("info", "🐘 Database connection pool created successfully.");
        dbInitialized = true;
    }
    catch (error) {
        const err = error;
        earlyLog("error", "🚨 Failed to create database connection pool", {
            error: err.message,
        });
        process.exit(1);
    }
}
else {
    earlyLog("warn", "⚠️ DATABASE_URL not set. Database features will be disabled.");
}
async function initializeDatabase() {
    // At this point, Gossamer should be initialized, so we can use emit
    const { emit } = await Promise.resolve().then(() => __importStar(require("./gossamer")));
    if (config_1.default.NO_DB) {
        emit("system:startup", { service: "Database", status: "disabled", reason: "--noDB flag" });
        return;
    }
    if (!dbInitialized) {
        emit("system:startup", { service: "Database", status: "skipped", reason: "not initialized" });
        return;
    }
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS uploaded_files (
            id SERIAL PRIMARY KEY,
            file_key TEXT NOT NULL UNIQUE,
            file_url TEXT NOT NULL,
            file_name TEXT NOT NULL,
            uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `;
    try {
        await pool.query(createTableQuery);
        emit("system:startup", { service: "Database", status: "ready", table: "uploaded_files" });
    }
    catch (err) {
        const error = err;
        emit("system:error", { service: "Database", error: error.stack });
        process.exit(1);
    }
}
function query(text, params) {
    if (!dbInitialized || !pool) {
        throw new Error("Database is not available.");
    }
    return pool.query(text, params);
}
function isDatabaseInitialized() {
    return dbInitialized;
}
//# sourceMappingURL=dbClient.js.map