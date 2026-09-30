import "server-only";

import { getDb } from "@/server/db/client";
import { mailCapture } from "@/server/db/schema";
import { getEnv, type Env } from "@/server/env";
import { AppError } from "@/server/http/errors";

export type MailKind = "verify_email" | "reset_password";

export interface MailMessage {
  to: string;
  kind: MailKind;
  subject: string;
  text: string;
}

export interface MailDelivery {
  /** False means no account mail can reach anyone, so registration is closed. */
  available: boolean;
  mode: "captured" | "none";
}

/**
 * How account mail is handled on this deployment. There are two transports:
 * `capture` stores the message in mail_capture (tests and staging), `none`
 * refuses. There is deliberately no real delivery transport: sending mail to
 * arbitrary addresses needs a domain the operator controls, which does not exist.
 */
export function mailDelivery(env: Pick<Env, "emailTransport">): MailDelivery {
  return env.emailTransport === "capture"
    ? { available: true, mode: "captured" }
    : { available: false, mode: "none" };
}

/** Send one account message through the configured transport. Throws `unavailable` when there is none. */
export async function sendMail(message: MailMessage): Promise<void> {
  if (!mailDelivery(getEnv()).available) {
    throw new AppError("unavailable", "Email delivery is not configured.");
  }
  await getDb().insert(mailCapture).values({
    toAddress: message.to.trim().toLowerCase(),
    kind: message.kind,
    subject: message.subject,
    body: message.text,
  });
}
