import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { consentRecord, user } from "@/server/db/schema";

import { authRequest, createVerifiedUser, signUp } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "atlas@orbitdiff.test";

/** Fields a client must never be able to set, with a value an attacker would try. */
const SELF_GRANTED: Array<[string, unknown]> = [
  ["status", "suspended"],
  ["reviewHour", 3],
  ["onboardedAt", "2026-01-01T00:00:00.000Z"],
  ["emailVerified", true],
  ["role", "admin"],
  ["isAdmin", true],
];

async function userRow() {
  const [row] = await getDb().select().from(user).where(eq(user.email, EMAIL));
  return row;
}

describe("fields a client cannot grant itself", () => {
  it.each(SELF_GRANTED)("rejects %s at sign-up and creates no user", async (field, value) => {
    const response = await signUp({ email: EMAIL, extra: { [field]: value } });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("FIELD_NOT_ALLOWED");
    expect(body.message).toContain(field);
    expect(await userRow()).toBeUndefined();
  });

  it("stores only defaults for protected columns after a normal sign-up", async () => {
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    expect(await userRow()).toMatchObject({
      status: "active",
      reviewHour: 9,
      onboardedAt: null,
      emailVerified: false,
      image: null,
    });
    expect(Object.keys((await userRow()) ?? {})).not.toContain("role");
  });

  it.each([
    ...SELF_GRANTED.filter(([field]) => field !== "emailVerified"),
    ["emailVerified", false],
    ["acceptedTermsVersion", "1999-01-01"],
    ["marketingOptIn", true],
    ["image", "https://example.test/a.png"],
  ] as Array<[string, unknown]>)("rejects %s at update-user and leaves the row unchanged", async (field, value) => {
    const { cookie } = await createVerifiedUser({ email: EMAIL, name: "Atlas" });
    const before = await userRow();
    const response = await authRequest("/update-user", {
      json: { name: "Renamed", [field]: value },
      cookie,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("FIELD_NOT_ALLOWED");
    const after = await userRow();
    expect(after).toEqual(before);
    expect(after).toMatchObject({ name: "Atlas", status: "active", reviewHour: 9, onboardedAt: null });
    expect(after?.emailVerified).toBe(true);
  });

  it("does not let update-user change marketing consent without a consent record", async () => {
    const { cookie, userId } = await createVerifiedUser({ email: EMAIL });
    await authRequest("/update-user", { json: { marketingOptIn: true }, cookie });
    expect((await userRow())?.marketingOptIn).toBe(false);
    const rows = await getDb().select().from(consentRecord).where(eq(consentRecord.userId, userId));
    expect(rows.filter((row) => row.kind === "marketing")).toHaveLength(1);
  });

  it("lets update-user change the name and the timezone", async () => {
    const { cookie } = await createVerifiedUser({ email: EMAIL, name: "Atlas" });
    const response = await authRequest("/update-user", {
      json: { name: "Atlas Studio", timezone: "America/New_York" },
      cookie,
    });
    expect(response.status).toBe(200);
    expect(await userRow()).toMatchObject({ name: "Atlas Studio", timezone: "America/New_York" });
  });

  it("stores a timezone written in another case under its canonical name at update-user", async () => {
    const { cookie } = await createVerifiedUser({ email: EMAIL, name: "Atlas" });
    const response = await authRequest("/update-user", { json: { timezone: "america/new_york" }, cookie });
    expect(response.status).toBe(200);
    expect(await userRow()).toMatchObject({ timezone: "America/New_York" });
  });

  it("stores a timezone written in another case under its canonical name at sign-up", async () => {
    expect((await signUp({ email: EMAIL, timezone: "aSiA/tOkYo" })).status).toBe(200);
    expect(await userRow()).toMatchObject({ timezone: "Asia/Tokyo" });
  });

  it("rejects an invalid timezone or an empty name at update-user", async () => {
    const { cookie } = await createVerifiedUser({ email: EMAIL, name: "Atlas" });
    const zone = await authRequest("/update-user", { json: { timezone: "Mars/Olympus" }, cookie });
    expect(zone.status).toBe(422);
    expect((await zone.json()).code).toBe("INVALID_TIMEZONE");
    const name = await authRequest("/update-user", { json: { name: "   " }, cookie });
    expect(name.status).toBe(422);
    expect((await name.json()).code).toBe("INVALID_NAME");
    expect(await userRow()).toMatchObject({ name: "Atlas", timezone: "UTC" });
  });

  it("refuses update-user without a session", async () => {
    const response = await authRequest("/update-user", { json: { name: "Nobody" } });
    expect(response.status).toBe(401);
  });
});
