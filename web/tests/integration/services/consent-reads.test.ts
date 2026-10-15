import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { consentRecord } from "@/server/db/schema";
import { listUsers } from "@/server/services/admin";
import { getConsentState } from "@/server/services/consent";

import { createVerifiedUser, resetDatabase, restoreTestEnv } from "../../helpers";
import { ATLAS, NOVA, NOW, OWNER } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

interface Traffic {
  statements: string[];
  rows: number;
}

/**
 * Run `work` and record every statement sent through the shared pool, with the
 * number of rows that came back. The statements still run against the database.
 */
async function observe<T>(work: () => Promise<T>): Promise<{ result: T; traffic: Traffic }> {
  const pool = getDb().$client;
  const original = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  const traffic: Traffic = { statements: [], rows: 0 };
  const spy = vi.spyOn(pool, "query").mockImplementation(((...args: unknown[]) => {
    const [query] = args;
    traffic.statements.push(typeof query === "string" ? query : String((query as { text?: unknown })?.text ?? ""));
    const outcome = original(...args);
    if (outcome instanceof Promise) {
      return outcome.then((value: { rows?: unknown[] }) => {
        traffic.rows += value?.rows?.length ?? 0;
        return value;
      });
    }
    return outcome;
  }) as never);
  try {
    return { result: await work(), traffic };
  } finally {
    spy.mockRestore();
  }
}

/** Append `count` product news rows that alternate between on and off, the newest on. */
async function longMarketingLog(userId: string, count: number): Promise<void> {
  // After the rows written at sign-up, which carry the real clock.
  const start = Date.now() + 60_000;
  await getDb()
    .insert(consentRecord)
    .values(
      Array.from({ length: count }, (_, index) => ({
        userId,
        kind: "marketing",
        version: CONSENT_VERSIONS.marketing,
        granted: index % 2 === 1,
        source: "settings",
        recordedAt: new Date(start + index * 1000),
      })),
    );
}

describe("reading consent state", () => {
  it("reads one row per kind, however long the log of a user is", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await longMarketingLog(atlas.userId, 40);

    const { result, traffic } = await observe(() => getConsentState(atlas.userId));

    expect(result.marketing).toMatchObject({ granted: true, version: CONSENT_VERSIONS.marketing });
    expect(result.terms).toMatchObject({ granted: true, version: CONSENT_VERSIONS.terms });
    expect(result.privacy).toMatchObject({ granted: true, version: CONSENT_VERSIONS.privacy });
    expect(traffic.rows).toBeLessThanOrEqual(3);
  });

  it("reads the consent of every listed user in one statement on the admin screen", async () => {
    const owner = await createVerifiedUser({ email: OWNER, name: "Owner", onboarded: true });
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await createVerifiedUser({ email: NOVA, onboarded: true });
    await longMarketingLog(atlas.userId, 40);

    const { result, traffic } = await observe(() => listUsers(owner.userId, {}, NOW));

    expect(result.data).toHaveLength(3);
    expect(result.data.find((item) => item.id === atlas.userId)?.consent.marketing).toMatchObject({ granted: true });
    expect(result.data.every((item) => item.consent.terms?.granted === true)).toBe(true);
    expect(traffic.statements.filter((statement) => statement.includes('"consent_record"'))).toHaveLength(1);
  });
});
