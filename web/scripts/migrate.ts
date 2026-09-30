import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Apply pending SQL migrations. Runs in the build step, where the migration files exist.
 * Uses the direct (unpooled) connection when one is configured.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not configured; migrations were not applied.");
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
    console.log("migrations: applied");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("migrations: failed", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
