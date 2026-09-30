import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/staging/mailbox/route";
import { closeDb } from "@/server/db/client";
import { sendMail } from "@/server/mail/transport";

import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";
import { callRoute } from "../../helpers/http";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const bearer = () => ({ authorization: `Bearer ${process.env.MAILBOX_SECRET}` });

const mailbox = (query: string, headers: Record<string, string> = {}) =>
  callRoute(GET, { url: `/api/staging/mailbox${query}`, origin: null, headers });

async function seed(): Promise<void> {
  await sendMail({ to: "atlas@orbitdiff.test", kind: "verify_email", subject: "First", text: "one" });
  await sendMail({ to: "nova@orbitdiff.test", kind: "verify_email", subject: "Other", text: "other" });
  await sendMail({ to: "atlas@orbitdiff.test", kind: "reset_password", subject: "Second", text: "two" });
}

describe("GET /api/staging/mailbox", () => {
  it("needs the mailbox secret", async () => {
    await seed();
    const missing = await mailbox("?to=atlas@orbitdiff.test");
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.code).toBe("unauthenticated");
    const wrong = await mailbox("?to=atlas@orbitdiff.test", {
      authorization: `Bearer ${"wrong-".repeat(6)}value`,
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain("First");
  });

  it("returns the captured mail for one address, newest first", async () => {
    await seed();
    const response = await mailbox("?to=Atlas@OrbitDiff.test", bearer());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pagination).toEqual({ page: 1, pageSize: 25, totalItems: 2, totalPages: 1 });
    expect(body.data.map((mail: { subject: string }) => mail.subject)).toEqual(["Second", "First"]);
    expect(body.data[0]).toMatchObject({
      to: "atlas@orbitdiff.test",
      kind: "reset_password",
      subject: "Second",
      text: "two",
    });
    expect(typeof body.data[0].createdAt).toBe("string");
  });

  it("returns an empty list for an address with no mail", async () => {
    await seed();
    const body = await (await mailbox("?to=nobody@orbitdiff.test", bearer())).json();
    expect(body.data).toEqual([]);
  });

  it("rejects a request without an address", async () => {
    const response = await mailbox("", bearer());
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({ code: "invalid_input", details: { fields: ["to"] } });
  });

  it("answers 404 when the transport is none, even with the secret", async () => {
    await seed();
    setTestEnv({ EMAIL_TRANSPORT: "none" });
    const response = await mailbox("?to=atlas@orbitdiff.test", bearer());
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("answers 404 when no mailbox secret is configured", async () => {
    const headers = bearer();
    setTestEnv({ MAILBOX_SECRET: undefined });
    expect((await mailbox("?to=atlas@orbitdiff.test", headers)).status).toBe(404);
    expect((await mailbox("?to=atlas@orbitdiff.test", { authorization: "Bearer " })).status).toBe(404);
  });
});
