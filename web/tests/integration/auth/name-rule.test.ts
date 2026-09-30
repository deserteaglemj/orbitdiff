import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { auditEvent, user } from "@/server/db/schema";

import { authRequest, createVerifiedUser, signUp } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "atlas@orbitdiff.test";

/**
 * Names that hold a control character. Better Auth stores the name exactly as
 * it was sent, so one at either end counts as much as one in the middle.
 */
const CONTROL_NAMES: Array<[string, string]> = [
  ["a NUL byte", "Atlas\u0000Studio"],
  ["only a NUL byte", "\u0000"],
  ["a line break inside it", "Atlas\nStudio"],
  ["a line break at the end", "Atlas\n"],
  ["an escape character", "\u001bAtlas"],
  ["a C1 control character", "Atlas\u0085Studio"],
];

async function userRow() {
  const [row] = await getDb().select().from(user).where(eq(user.email, EMAIL));
  return row;
}

describe("control characters in the name on the Better Auth paths", () => {
  it.each(CONTROL_NAMES)("update-user refuses a name with %s and changes nothing", async (_label, name) => {
    const { cookie } = await createVerifiedUser({ email: EMAIL, name: "Atlas" });
    const before = await userRow();
    const response = await authRequest("/update-user", { json: { name }, cookie });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("INVALID_NAME");
    expect(body.message).toBe("The name must not contain control characters such as line breaks.");
    expect(await userRow()).toEqual(before);
    expect(before?.name).toBe("Atlas");
  });

  it("update-user refuses the name and keeps the timezone sent with it", async () => {
    const { cookie } = await createVerifiedUser({ email: EMAIL, name: "Atlas" });
    const response = await authRequest("/update-user", {
      json: { name: "Atlas\nStudio", timezone: "America/New_York" },
      cookie,
    });
    expect(response.status).toBe(422);
    expect(await userRow()).toMatchObject({ name: "Atlas", timezone: "UTC" });
  });

  it.each(CONTROL_NAMES)("sign-up refuses a name with %s and creates no user", async (_label, name) => {
    const response = await signUp({ email: EMAIL, name });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("INVALID_NAME");
    expect(body.message).toBe("The name must not contain control characters such as line breaks.");
    expect(await userRow()).toBeUndefined();
    const audit = await getDb().select({ action: auditEvent.action, detail: auditEvent.detail }).from(auditEvent);
    expect(audit).toEqual([{ action: "registration_refused", detail: { code: "INVALID_NAME" } }]);
  });

  it("still accepts letters outside ASCII and spaces inside the name at update-user", async () => {
    const { cookie } = await createVerifiedUser({ email: EMAIL, name: "Atlas" });
    const response = await authRequest("/update-user", { json: { name: "Zoë Åström 工作室" }, cookie });
    expect(response.status).toBe(200);
    expect((await userRow())?.name).toBe("Zoë Åström 工作室");
  });

  it("still accepts letters outside ASCII and spaces inside the name at sign-up", async () => {
    const response = await signUp({ email: EMAIL, name: "Zoë Åström 工作室" });
    expect(response.status).toBe(200);
    expect((await userRow())?.name).toBe("Zoë Åström 工作室");
  });

  it("keeps the length message for a name that is too long", async () => {
    const { cookie } = await createVerifiedUser({ email: EMAIL, name: "Atlas" });
    const response = await authRequest("/update-user", { json: { name: "a".repeat(101) }, cookie });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "INVALID_NAME",
      message: "Enter a name of 1 to 100 characters.",
    });
  });
});
