import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import {
  activityEntry,
  auditEvent,
  exportSnapshot,
  job,
  mailCapture,
  profile,
  rateLimit,
  session,
  user,
  verification,
} from "@/server/db/schema";
import { runRetention } from "@/server/jobs/retention";

import { resetDatabase, signUp } from "../../helpers";
import { addSnapshot, type Owner, ownerWithProfile } from "./support";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY - extraMs);

beforeEach(resetDatabase);
afterAll(closeDb);

async function addJob(owner: Owner, key: string, status: string, finishedAt: Date | null) {
  const [row] = await getDb()
    .insert(job)
    .values({
      userId: owner.userId,
      profileId: owner.profileId,
      kind: "daily_review",
      status,
      dedupeKey: `daily:${owner.profileId}:${key}`,
      finishedAt,
    })
    .returning({ id: job.id });
  return row?.id as string;
}

async function addActivity(owner: Owner, occurredAt: Date) {
  const [row] = await getDb()
    .insert(activityEntry)
    .values({ userId: owner.userId, profileId: owner.profileId, kind: "review", status: "ok", summary: {}, occurredAt })
    .returning({ id: activityEntry.id });
  return row?.id as string;
}

async function pendingAccount(email: string, createdAt: Date): Promise<string> {
  const response = await signUp({ email });
  expect(response.status).toBe(200);
  const [row] = await getDb().update(user).set({ createdAt }).where(eq(user.email, email)).returning({ id: user.id });
  if (!row) throw new Error("the pending account was not created");
  return row.id;
}

const ids = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map((row) => row.id);

describe("runRetention", () => {
  it("removes finished jobs past their window and keeps recent and unfinished ones", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const old = [
      await addJob(owner, "a", "succeeded", daysAgo(LIMITS.retainJobsDays, 1)),
      await addJob(owner, "b", "failed", daysAgo(LIMITS.retainJobsDays + 5)),
      await addJob(owner, "c", "cancelled", daysAgo(LIMITS.retainJobsDays + 9)),
    ];
    const recent = await addJob(owner, "d", "succeeded", daysAgo(LIMITS.retainJobsDays - 1));
    const waiting = await addJob(owner, "e", "queued", null);

    const result = await runRetention({ now: NOW });

    expect(result.jobs).toBe(old.length);
    expect((await ids(getDb().select({ id: job.id }).from(job))).sort()).toEqual([recent, waiting].sort());
  });

  it("removes activity past its window and keeps newer entries", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addActivity(owner, daysAgo(LIMITS.retainActivityDays, 1));
    const kept = await addActivity(owner, daysAgo(LIMITS.retainActivityDays - 1));

    const result = await runRetention({ now: NOW });

    expect(result.activity).toBe(1);
    expect(await ids(getDb().select({ id: activityEntry.id }).from(activityEntry))).toEqual([kept]);
  });

  it("removes an account that stayed unverified for more than seven days, with its leftovers", async () => {
    const staleId = await pendingAccount("nova@orbitdiff.test", daysAgo(LIMITS.retainUnverifiedAccountDays, 1));
    await getDb().insert(verification).values({
      id: "v-stale",
      identifier: "reset-password:stale",
      value: staleId,
      expiresAt: new Date(NOW.getTime() + DAY),
    });

    const result = await runRetention({ now: NOW });

    expect(result.unverifiedAccounts).toBe(1);
    expect(await getDb().select({ id: user.id }).from(user)).toEqual([]);
    expect(await getDb().select().from(mailCapture).where(eq(mailCapture.toAddress, "nova@orbitdiff.test"))).toEqual([]);
    expect(await getDb().select().from(verification).where(eq(verification.value, staleId))).toEqual([]);
  });

  it("keeps a recent unverified account and an old verified one", async () => {
    const recentId = await pendingAccount("nova@orbitdiff.test", daysAgo(LIMITS.retainUnverifiedAccountDays - 1));
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await getDb().update(user).set({ createdAt: daysAgo(400) }).where(eq(user.id, owner.userId));

    const result = await runRetention({ now: NOW });

    expect(result.unverifiedAccounts).toBe(0);
    expect((await ids(getDb().select({ id: user.id }).from(user))).sort()).toEqual([recentId, owner.userId].sort());
  });

  it("keeps an old account that is unverified but holds a profile and its imports", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const snapshotId = await addSnapshot(owner, {
      capturedAt: "2026-09-01T12:00:00+00:00",
      followers: ["nova_labs"],
      following: ["pixel_forge"],
    });
    // An account that got past sign-up and was later marked unverified, for example by an operator.
    await getDb()
      .update(user)
      .set({ emailVerified: false, createdAt: daysAgo(LIMITS.retainUnverifiedAccountDays + 30) })
      .where(eq(user.id, owner.userId));

    const result = await runRetention({ now: NOW });

    expect(result.unverifiedAccounts).toBe(0);
    expect(await ids(getDb().select({ id: user.id }).from(user))).toEqual([owner.userId]);
    expect(await ids(getDb().select({ id: profile.id }).from(profile))).toEqual([owner.profileId]);
    expect(await ids(getDb().select({ id: exportSnapshot.id }).from(exportSnapshot))).toEqual([snapshotId]);
  });

  it("removes a stale sign-up next to an unverified account that holds a profile", async () => {
    const kept = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await getDb()
      .update(user)
      .set({ emailVerified: false, createdAt: daysAgo(LIMITS.retainUnverifiedAccountDays + 30) })
      .where(eq(user.id, kept.userId));
    await pendingAccount("nova@orbitdiff.test", daysAgo(LIMITS.retainUnverifiedAccountDays, 1));

    const result = await runRetention({ now: NOW });

    expect(result.unverifiedAccounts).toBe(1);
    expect(await ids(getDb().select({ id: user.id }).from(user))).toEqual([kept.userId]);
  });

  it("removes captured mail past its window", async () => {
    await getDb().insert(mailCapture).values([
      { toAddress: "atlas@orbitdiff.test", kind: "verify_email", subject: "old", body: "old", createdAt: daysAgo(LIMITS.retainCapturedMailDays, 1) },
      { toAddress: "atlas@orbitdiff.test", kind: "verify_email", subject: "new", body: "new", createdAt: daysAgo(LIMITS.retainCapturedMailDays - 1) },
    ]);

    const result = await runRetention({ now: NOW });

    expect(result.mail).toBe(1);
    expect((await getDb().select().from(mailCapture)).map((row) => row.subject)).toEqual(["new"]);
  });

  it("removes expired verification rows and keeps live ones", async () => {
    await getDb().insert(verification).values([
      { id: "v-expired", identifier: "a", value: "a", expiresAt: new Date(NOW.getTime() - 1000) },
      { id: "v-live", identifier: "b", value: "b", expiresAt: new Date(NOW.getTime() + 1000) },
    ]);

    const result = await runRetention({ now: NOW });

    expect(result.verifications).toBe(1);
    expect(await ids(getDb().select({ id: verification.id }).from(verification))).toEqual(["v-live"]);
  });

  it("removes rate limit rows whose last request is more than ten minutes old", async () => {
    await getDb().insert(rateLimit).values([
      { id: "r-old", key: "old", count: 3, lastRequest: NOW.getTime() - 10 * 60_000 - 1 },
      { id: "r-new", key: "new", count: 3, lastRequest: NOW.getTime() - 9 * 60_000 },
    ]);

    const result = await runRetention({ now: NOW });

    expect(result.rateLimits).toBe(1);
    expect(await ids(getDb().select({ id: rateLimit.id }).from(rateLimit))).toEqual(["r-new"]);
  });

  it("removes sessions that have expired and keeps live ones", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const signedIn = await ids(getDb().select({ id: session.id }).from(session).where(eq(session.userId, owner.userId)));
    await getDb()
      .update(session)
      .set({ expiresAt: new Date(NOW.getTime() + DAY) })
      .where(eq(session.userId, owner.userId));
    await getDb().insert(session).values([
      { id: "s-expired", token: "t-expired", userId: owner.userId, expiresAt: new Date(NOW.getTime() - 1000), updatedAt: NOW },
      { id: "s-old", token: "t-old", userId: owner.userId, expiresAt: daysAgo(30), updatedAt: NOW },
    ]);

    const result = await runRetention({ now: NOW });

    expect(result.sessions).toBe(2);
    expect((await ids(getDb().select({ id: session.id }).from(session))).sort()).toEqual([...signedIn].sort());
  });

  it("removes security events past their window and keeps newer ones", async () => {
    await getDb().insert(auditEvent).values([
      { action: "registration_refused", detail: { code: "REGISTRATION_CLOSED" }, at: daysAgo(LIMITS.retainAuditDays, 1) },
      { action: "registration_refused", detail: { code: "REGISTRATION_CLOSED" }, at: daysAgo(LIMITS.retainAuditDays + 40) },
      { action: "account_deleted", at: daysAgo(LIMITS.retainAuditDays - 1) },
    ]);

    const result = await runRetention({ now: NOW });

    expect(result.auditEvents).toBe(2);
    expect((await getDb().select({ action: auditEvent.action }).from(auditEvent)).map((row) => row.action)).toEqual([
      "account_deleted",
    ]);
  });

  it("never removes a snapshot, a profile, or a verified user, however old", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const snapshotId = await addSnapshot(owner, {
      capturedAt: "2020-01-01T00:00:00+00:00",
      followers: ["nova_labs"],
      following: ["pixel_forge"],
      importedAt: new Date("2020-01-02T00:00:00.000Z"),
    });
    await getDb().update(user).set({ createdAt: new Date("2020-01-01T00:00:00.000Z") }).where(eq(user.id, owner.userId));
    await getDb().update(profile).set({ createdAt: new Date("2020-01-01T00:00:00.000Z") }).where(eq(profile.id, owner.profileId));

    const result = await runRetention({ now: NOW });

    expect(result.unverifiedAccounts).toBe(0);
    expect(await ids(getDb().select({ id: exportSnapshot.id }).from(exportSnapshot))).toEqual([snapshotId]);
    expect(await ids(getDb().select({ id: profile.id }).from(profile))).toEqual([owner.profileId]);
    expect(await ids(getDb().select({ id: user.id }).from(user))).toEqual([owner.userId]);
  });

  it("removes at most one batch of each kind per run and reports the total", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    for (const key of ["a", "b", "c"]) await addJob(owner, key, "succeeded", daysAgo(LIMITS.retainJobsDays + 1));
    for (let index = 0; index < 3; index += 1) await addActivity(owner, daysAgo(LIMITS.retainActivityDays + 1));

    const first = await runRetention({ now: NOW, batch: 2 });
    const second = await runRetention({ now: NOW, batch: 2 });

    expect(first).toMatchObject({ jobs: 2, activity: 2, total: 4 });
    expect(second).toMatchObject({ jobs: 1, activity: 1, total: 2 });
  });
});
