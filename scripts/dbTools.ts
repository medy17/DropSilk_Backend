import fs from "fs/promises";
import path from "path";
import { Client, type ClientConfig } from "pg";

function resolveSsl(connectionString: string): false | { rejectUnauthorized: false } {
    const explicitPreference = String(process.env.DATABASE_SSL || "").toLowerCase();
    if (["0", "false", "disable", "off"].includes(explicitPreference)) {
        return false;
    }
    if (["1", "true", "require", "on"].includes(explicitPreference)) {
        return { rejectUnauthorized: false };
    }

    const parsed = new URL(connectionString);
    const sslMode = parsed.searchParams.get("sslmode");
    if (sslMode === "disable") {
        return false;
    }

    if (["localhost", "127.0.0.1"].includes(parsed.hostname.toLowerCase())) {
        return false;
    }

    return { rejectUnauthorized: false };
}

export function getDatabaseConfig(): ClientConfig {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is required.");
    }

    return {
        connectionString,
        ssl: resolveSsl(connectionString),
    };
}

export async function withClient<T>(callback: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client(getDatabaseConfig());
    await client.connect();

    try {
        return await callback(client);
    } finally {
        await client.end();
    }
}

export async function ensureMigrationsTable(client: Client): Promise<void> {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

export async function getMigrationFiles(): Promise<string[]> {
    const migrationsDir = path.join(process.cwd(), "migrations");
    const entries = await fs.readdir(migrationsDir, { withFileTypes: true });

    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
        .map((entry) => entry.name)
        .sort();
}

export async function readMigrationFile(fileName: string): Promise<string> {
    const migrationPath = path.join(process.cwd(), "migrations", fileName);
    return fs.readFile(migrationPath, "utf8");
}

export function assertLocalDatabaseUrl(): void {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is required.");
    }

    const parsed = new URL(connectionString);
    const host = parsed.hostname.toLowerCase();
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    if (!isLocalHost && process.env.ALLOW_REMOTE_DB_RESET !== "true") {
        throw new Error(
            "Refusing to reset a non-local database. Set ALLOW_REMOTE_DB_RESET=true to override."
        );
    }
}
