// --- src/dbClient.js ---

const { Pool } = require("pg");
const { log } = require("./utils");
const config = require("./config");
// We can try to use eventBus here, but it might be too early for listeners
// So we stick to log for critical startup messages.

let pool;
let dbInitialized = false;

// Honour --noDB / NO_DB
if (config.NO_DB) {
    log("info", "🛑 Database disabled via --noDB/NO_DB. Skipping DB initialisation.");
    dbInitialized = false;
} else if (process.env.DATABASE_URL) {
    try {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false,
            },
        });
        log("info", "🐘 Database connection pool created successfully.");
        dbInitialized = true;
    } catch (error) {
        log("error", "🚨 Failed to create database connection pool", {
            error: error.message,
        });
        process.exit(1);
    }
} else {
    log("warn", "⚠️ DATABASE_URL not set. Database features will be disabled.");
}

const initializeDatabase = async () => {
    if (config.NO_DB) {
        log("info", "DB disabled via --noDB/NO_DB. Skipping table creation.");
        return;
    }
    if (!dbInitialized) {
        log("warn", "DB not initialized, skipping table creation.");
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
        log("info", "✅ Database table 'uploaded_files' is ready.");
    } catch (err) {
        log("error", "🚨 Error initializing database table", {
            error: err.stack,
        });
        process.exit(1);
    }
};

module.exports = {
    query: (text, params) => {
        if (!dbInitialized) {
            // Throwing is better for the service to catch and log via Event Bus
            throw new Error("Database is not available.");
        }
        return pool.query(text, params);
    },
    initializeDatabase,
    isDatabaseInitialized: () => dbInitialized,
};