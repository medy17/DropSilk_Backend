// --- src/dbClient.js ---

const { Pool } = require("pg");
const { log } = require("./utils");

// A connection pool is way better than a single client.
// It manages multiple connections, so your server doesn't get bogged down
// waiting for a free connection. It's faster and more resilient.
let pool;

try {
    if (!process.env.DATABASE_URL) {
        throw new Error(
            "DATABASE_URL environment variable is not set. The show cannot go on.",
        );
    }

    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        // This is CRITICAL for connecting to cloud databases like AWS RDS
        // which require an encrypted connection.
        ssl: {
            rejectUnauthorized: false,
        },
    });

    log("info", "🐘 Database connection pool created successfully.");
} catch (error) {
    log("error", "🚨 Failed to create database connection pool", {
        error: error.message,
    });
    // If we can't connect to the DB, the app is useless. Crash it.
    process.exit(1);
}

// A simple function to create our table if it doesn't already exist.
// This is "idempotent" - you can run it a million times and it will only
// create the table on the first run.
const initializeDatabase = async () => {
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
        // Again, if we can't set up the table, the app is useless.
        process.exit(1);
    }
};

module.exports = {
    // Export the query function from the pool
    query: (text, params) => pool.query(text, params),
    initializeDatabase,
};