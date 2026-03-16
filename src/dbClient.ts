// --- src/dbClient.ts ---

import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import config from "./config";

let pool: Pool | undefined;
let dbInitialized = false;

function shouldUseSsl(connectionString: string): false | { rejectUnauthorized: false } {
    const explicitPreference = String(process.env.DATABASE_SSL || "").toLowerCase();
    if (["0", "false", "disable", "off"].includes(explicitPreference)) {
        return false;
    }
    if (["1", "true", "require", "on"].includes(explicitPreference)) {
        return { rejectUnauthorized: false };
    }

    try {
        const parsed = new URL(connectionString);
        const sslMode = parsed.searchParams.get("sslmode");
        if (sslMode === "disable") {
            return false;
        }

        const host = parsed.hostname.toLowerCase();
        if (["localhost", "127.0.0.1"].includes(host)) {
            return false;
        }
    } catch {
        // Fall back to SSL for hosted database providers.
    }

    return { rejectUnauthorized: false };
}

// Helper for early-stage logging (before Gossamer is initialized)
const earlyLog = (level: string, message: string, meta: Record<string, unknown> = {}): void => {
    console.log(JSON.stringify({ level: level.toUpperCase(), message, ...meta }));
};

// Honour --noDB / NO_DB
if (config.NO_DB) {
    earlyLog("info", "🛑 Database disabled via --noDB/NO_DB. Skipping DB initialisation.");
    dbInitialized = false;
} else if (process.env.DATABASE_URL) {
    try {
        const connectionString = process.env.DATABASE_URL;
        pool = new Pool({
            connectionString,
            ssl: shouldUseSsl(connectionString),
        });
        earlyLog("info", "🐘 Database connection pool created successfully.");
        dbInitialized = true;
    } catch (error) {
        const err = error as Error;
        earlyLog("error", "🚨 Failed to create database connection pool", {
            error: err.message,
        });
        process.exit(1);
    }
} else {
    earlyLog("warn", "⚠️ DATABASE_URL not set. Database features will be disabled.");
}

export async function initializeDatabase(): Promise<void> {
    // At this point, Gossamer should be initialized, so we can use emit
    const { emit } = await import("./gossamer");

    if (config.NO_DB) {
        emit("system:startup", { service: "Database", status: "disabled", reason: "--noDB flag" });
        return;
    }
    if (!dbInitialized) {
        emit("system:startup", { service: "Database", status: "skipped", reason: "not initialized" });
        return;
    }

    try {
        const schemaCheck = await pool!.query<{
            rooms_exists: string | null;
            uploaded_files_exists: string | null;
        }>(`
            SELECT
                to_regclass('public.rooms')::text AS rooms_exists,
                to_regclass('public.uploaded_files')::text AS uploaded_files_exists
        `);

        const schemaStatus = schemaCheck.rows[0];
        if (!schemaStatus?.rooms_exists || !schemaStatus?.uploaded_files_exists) {
            throw new Error(
                "Database schema is missing required tables. Run migrations before starting the app."
            );
        }

        emit("system:startup", { service: "Database", status: "ready" });
    } catch (err) {
        const error = err as Error;
        emit("system:error", { service: "Database", error: error.stack });
        process.exit(1);
    }
}

export function query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
): Promise<QueryResult<T>> {
    if (!dbInitialized || !pool) {
        throw new Error("Database is not available.");
    }
    return pool.query<T>(text, params);
}

export async function withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>
): Promise<T> {
    if (!dbInitialized || !pool) {
        throw new Error("Database is not available.");
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export function isDatabaseInitialized(): boolean {
    return dbInitialized;
}
