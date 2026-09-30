import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { mailCapture } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/http/errors";
import { mailDelivery, sendMail } from "@/server/mail/transport";

import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";
import { latestMail } from "../../helpers/mail";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

describe("mail transport", () => {
  it("captures a message instead of delivering it", async () => {
    await sendMail({
      to: "Atlas@OrbitDiff.test",
      kind: "verify_email",
      subject: "Confirm your email",
      text: "Open http://127.0.0.1:3100/verify to confirm.",
    });
    const mail = await latestMail("atlas@orbitdiff.test", "verify_email");
    expect(mail).toMatchObject({
      to: "atlas@orbitdiff.test",
      kind: "verify_email",
      subject: "Confirm your email",
      text: "Open http://127.0.0.1:3100/verify to confirm.",
    });
  });

  it("refuses to send when no transport is configured and stores nothing", async () => {
    setTestEnv({ EMAIL_TRANSPORT: "none" });
    const attempt = sendMail({
      to: "atlas@orbitdiff.test",
      kind: "reset_password",
      subject: "Reset your password",
      text: "link",
    });
    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({ code: "unavailable" });
    expect(await getDb().select().from(mailCapture)).toEqual([]);
  });

  it("reports whether mail can be delivered and how", () => {
    expect(mailDelivery(getEnv())).toEqual({ available: true, mode: "captured" });
    setTestEnv({ EMAIL_TRANSPORT: "none" });
    expect(mailDelivery(getEnv())).toEqual({ available: false, mode: "none" });
  });
});
