import { Pool } from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";

const pool = new Pool({ connectionString: inject("databaseUrl"), max: 1 });

afterAll(async () => {
  await pool.end();
});

describe("initial migration", () => {
  it("creates every application and auth table", async () => {
    const result = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "account",
      "activity_entry",
      "audit_event",
      "change_event",
      "consent_record",
      "export_snapshot",
      "job",
      "mail_capture",
      "profile",
      "rate_limit",
      "session",
      "system_state",
      "usage_daily",
      "user",
      "verification",
    ]);
  });

  it("allows only one current snapshot per profile", async () => {
    await pool.query(
      "insert into \"user\" (id, name, email, email_verified, created_at, updated_at) values ('u_migration', 'Atlas', 'atlas@orbitdiff.test', true, now(), now())",
    );
    const profile = await pool.query<{ id: string }>(
      "insert into profile (user_id, handle) values ('u_migration', 'atlas_studio') returning id",
    );
    const profileId = profile.rows[0]?.id;
    const insert = (digest: string) =>
      pool.query(
        `insert into export_snapshot (user_id, profile_id, snapshot_digest, content_digest, imported_at,
           followers_shards, following_shards, declared_complete_followers, declared_complete_following,
           followers_complete, following_complete, roster_bytes, is_current)
         values ('u_migration', $1, $2, $2, now(), '{}', '{}', false, false, false, false, 0, true)`,
        [profileId, digest],
      );
    await insert("a".repeat(64));
    await expect(insert("b".repeat(64))).rejects.toThrow(/snapshot_profile_current_unique/);
    await pool.query("delete from \"user\" where id = 'u_migration'");
    const remaining = await pool.query("select 1 from profile where user_id = 'u_migration'");
    expect(remaining.rowCount).toBe(0);
  });
});
