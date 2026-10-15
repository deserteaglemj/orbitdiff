import { sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { settleBackground } from "@/server/http/background";

/**
 * Empty every table in the public schema: truncate, restart identities, cascade.
 * Call it in beforeEach so each test starts from a blank database. It first
 * waits for background work (queued mail) so a late insert cannot leak into the
 * next test. The migration bookkeeping lives in the `drizzle` schema and is kept.
 */
export async function resetDatabase(): Promise<void> {
  await settleBackground();
  const db = getDb();
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  if (tables.rows.length === 0) return;
  const names = tables.rows.map((row) => `"${row.tablename.replaceAll('"', '""')}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} restart identity cascade`));
}
