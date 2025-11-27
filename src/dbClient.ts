// --- src/dbClient.ts ---

import { Pool } from "pg";
import { log } from "./utils";
import config from "./config";

let pool: Pool;
let dbInitialized = false;

if (config.NO_DB) {
    log(
        "info",
        "🛑 Database disabled via --noDB/NO_DB. Skipping DB initialisation.",
    );
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
    } catch (error: any) {
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
    } catch (err: any) {
        log("error", "🚨 Error initializing database table", {
            error: err.stack,
        });
        process.exit(1);
    }
};

const dbClient = {
    query: (text: string, params?: any[]) => {
        if (!dbInitialized) {
            throw new Error("Database is not available.");
        }
        return pool.query(text, params);
    },
    initializeDatabase,
    isDatabaseInitialized: () => dbInitialized,
};

export default dbClient;