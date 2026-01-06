// --- src/dbClient.js ---

const { Pool } = require("pg");
const config = require("./config");

let pool;
let dbInitialized = false;

// Helper for early-stage logging (before Gossamer is initialized)
const earlyLog = (level, message, meta = {}) => {
    console.log(JSON.stringify({ level: level.toUpperCase(), message, ...meta }));
};

// Honour --noDB / NO_DB
if (config.NO_DB) {
    earlyLog("info", "🛑 Database disabled via --noDB/NO_DB. Skipping DB initialisation.");
    dbInitialized = false;
} else if (process.env.DATABASE_URL) {
    try {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false,
            },
        });
        earlyLog("info", "🐘 Database connection pool created successfully.");
        dbInitialized = true;
    } catch (error) {
        earlyLog("error", "🚨 Failed to create database connection pool", {
            error: error.message,
        });
        process.exit(1);
    }
} else {
    earlyLog("warn", "⚠️ DATABASE_URL not set. Database features will be disabled.");
}

const initializeDatabase = async () => {
    // At this point, Gossamer should be initialized, so we can use emit
    const { emit } = require("./gossamer");

    if (config.NO_DB) {
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
    } catch (err) {
        emit("system:error", { service: "Database", error: err.stack });
        process.exit(1);
    }
};

module.exports = {
    query: (text, params) => {
        if (!dbInitialized) {
            throw new Error("Database is not available.");
        }
        return pool.query(text, params);
    },
    initializeDatabase,
    isDatabaseInitialized: () => dbInitialized,
};