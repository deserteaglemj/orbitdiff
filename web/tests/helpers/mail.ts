import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { mailCapture } from "@/server/db/schema";
import { settleBackground } from "@/server/http/background";

export type CapturedMailKind = "verify_email" | "reset_password";

export interface CapturedMail {
  id: string;
  to: string;
  kind: string;
  subject: string;
  text: string;
  createdAt: Date;
}

/**
 * The newest captured mail of one kind for an address, or null. Waits for
 * queued background sends first, so it can be called right after the request
 * that triggered the mail.
 */
export async function latestMail(to: string, kind: CapturedMailKind): Promise<CapturedMail | null> {
  await settleBackground();
  const [row] = await getDb()
    .select()
    .from(mailCapture)
    .where(and(eq(mailCapture.toAddress, to.trim().toLowerCase()), eq(mailCapture.kind, kind)))
    .orderBy(desc(mailCapture.createdAt), desc(mailCapture.id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    to: row.toAddress,
    kind: row.kind,
    subject: row.subject,
    text: row.body,
    createdAt: row.createdAt,
  };
}

/** The first http(s) link in a captured mail. Throws when there is none. */
export function extractLink(mail: Pick<CapturedMail, "text">): string {
  const match = /https?:\/\/[^\s<>"']+/.exec(mail.text);
  if (!match) throw new Error("the captured mail contains no link");
  return match[0];
}
