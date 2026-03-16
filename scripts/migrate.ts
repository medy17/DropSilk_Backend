import { ensureMigrationsTable, getMigrationFiles, readMigrationFile, withClient } from "./dbTools";

async function run(): Promise<void> {
    await withClient(async (client) => {
        await ensureMigrationsTable(client);

        const { rows } = await client.query<{ id: string }>(
            "SELECT id FROM schema_migrations ORDER BY id"
        );
        const applied = new Set(rows.map((row) => row.id));
        const migrationFiles = await getMigrationFiles();

        for (const fileName of migrationFiles) {
            if (applied.has(fileName)) {
                continue;
            }

            const sql = await readMigrationFile(fileName);
            await client.query("BEGIN");
            try {
                await client.query(sql);
                await client.query(
                    "INSERT INTO schema_migrations (id) VALUES ($1)",
                    [fileName]
                );
                await client.query("COMMIT");
                console.log(`Applied migration ${fileName}`);
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            }
        }
    });
}

run().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});
