import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as health } from "@/app/api/health/route";
import { getRegistrationState, REGISTRATION_NO_OPERATOR } from "@/server/auth/registration";
import { closeDb, getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { getEnv } from "@/server/env";

import { signUp } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";
import { callRoute } from "../../helpers/http";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "atlas@orbitdiff.test";
const REASON = "Registration is closed: the operator of this service has not been named yet.";

async function userCount(): Promise<number> {
  return (await getDb().select({ id: user.id }).from(user)).length;
}

async function expectRefusedForOperator(response: Response): Promise<void> {
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "REGISTRATION_CLOSED", message: REASON });
  expect(await userCount()).toBe(0);
}

describe("operator gate: registration stays closed until an operator is named", () => {
  it("words the reason exactly as the owner specified", () => {
    expect(REGISTRATION_NO_OPERATOR).toBe(REASON);
  });

  it("refuses sign-up and creates no user when OPERATOR_NAME is removed", async () => {
    setTestEnv({ OPERATOR_NAME: undefined });
    await expectRefusedForOperator(await signUp({ email: EMAIL }));
  });

  it("refuses sign-up and creates no user when OPERATOR_NAME is an empty string", async () => {
    setTestEnv({ OPERATOR_NAME: "" });
    await expectRefusedForOperator(await signUp({ email: EMAIL }));
  });

  it("refuses sign-up and creates no user when OPERATOR_NAME is whitespace only", async () => {
    setTestEnv({ OPERATOR_NAME: "  \t " });
    await expectRefusedForOperator(await signUp({ email: EMAIL }));
  });

  it("accepts sign-up once an operator is named", async () => {
    expect(getEnv().operatorName).toBe("OrbitDiff Test Operator");
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    expect(await userCount()).toBe(1);
  });

  it("is checked before the mail gate", async () => {
    setTestEnv({ OPERATOR_NAME: undefined, EMAIL_TRANSPORT: "none" });
    await expectRefusedForOperator(await signUp({ email: EMAIL }));
  });

  it("is checked before the capacity gate", async () => {
    setTestEnv({ CAPACITY_MAX_USERS: "1" });
    expect((await signUp({ email: "nova@orbitdiff.test" })).status).toBe(200);
    setTestEnv({ OPERATOR_NAME: undefined });
    const response = await signUp({ email: EMAIL });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "REGISTRATION_CLOSED", message: REASON });
    expect(await userCount()).toBe(1);
  });

  it("is checked before the access code gate", async () => {
    setTestEnv({ OPERATOR_NAME: undefined, SIGNUP_ACCESS_CODE: "orbit-preview-1" });
    await expectRefusedForOperator(await signUp({ email: EMAIL }));
    await expectRefusedForOperator(
      await signUp({ email: EMAIL, headers: { "x-signup-code": "orbit-preview-1" } }),
    );
  });

  it("is checked before the consent gate", async () => {
    setTestEnv({ OPERATOR_NAME: undefined });
    await expectRefusedForOperator(await signUp({ email: EMAIL, acceptedTermsVersion: null }));
  });

  it.each(["development", "test", "staging", "production"])("is closed in the %s stage", async (stage) => {
    setTestEnv({
      APP_STAGE: stage,
      APP_BASE_URL: "https://web.orbitdiff.test",
      EMAIL_TRANSPORT: stage === "production" ? "none" : "capture",
      OPERATOR_NAME: undefined,
    });
    expect(await getRegistrationState()).toMatchObject({ open: false, reason: REASON, code: "closed" });
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a single character", "Q"],
    ["a value that is not a string", 7],
  ])("fails closed when the configuration object carries %s as the operator name", async (_label, value) => {
    const forged = { ...getEnv(), operatorName: value as string | null };
    expect(await getRegistrationState(forged)).toMatchObject({ open: false, reason: REASON, code: "closed" });
  });

  it("makes /api/health report the same state and reason as the gate", async () => {
    const open = await (await callRoute(health, { url: "/api/health", origin: null })).json();
    expect(open.registration).toMatchObject({ open: true, reason: null });

    setTestEnv({ OPERATOR_NAME: undefined });
    const gate = await getRegistrationState();
    const closed = await (await callRoute(health, { url: "/api/health", origin: null })).json();
    expect(closed.registration).toMatchObject({ open: gate.open, reason: gate.reason });
    expect(closed.registration).toMatchObject({ open: false, reason: REASON });
  });
});
