import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb, type Executor } from "@/server/db/client";
import { systemState } from "@/server/db/schema";

afterAll(async () => {
  await closeDb();
});

async function writeState(executor: Executor, key: string): Promise<void> {
  await executor.insert(systemState).values({ key, value: { ok: true } });
}

describe("database client", () => {
  it("returns the same instance on every call", () => {
    expect(getDb()).toBe(getDb());
  });

  it("runs queries against the migrated schema", async () => {
    const result = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from "user"`);
    expect(result.rows[0]?.n).toBeGreaterThanOrEqual(0);
  });

  it("caps the pool at five connections", async () => {
    const pool = getDb().$client;
    expect(pool.options.max).toBe(5);
  });

  it("accepts both the database and an open transaction as an executor", async () => {
    const db = getDb();
    await db.delete(systemState).where(sql`${systemState.key} like 'client-test-%'`);
    await writeState(db, "client-test-direct");
    await expect(
      db.transaction(async (tx) => {
        await writeState(tx, "client-test-rolled-back");
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
    const rows = await db
      .select({ key: systemState.key })
      .from(systemState)
      .where(sql`${systemState.key} like 'client-test-%'`);
    expect(rows.map((row) => row.key)).toEqual(["client-test-direct"]);
    await db.delete(systemState).where(sql`${systemState.key} like 'client-test-%'`);
  });

  it("opens a fresh pool after it is closed", async () => {
    const before = getDb();
    await closeDb();
    const after = getDb();
    expect(after).not.toBe(before);
    const result = await after.execute<{ one: number }>(sql`select 1 as one`);
    expect(result.rows[0]?.one).toBe(1);
  });
});
