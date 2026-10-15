import { count, desc, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { mailCapture } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { bearerToken, constantTimeEqual } from "@/server/http/compare";
import { AppError } from "@/server/http/errors";
import { json, route } from "@/server/http/handler";
import { listEnvelope, parsePagination } from "@/server/http/pagination";

export const dynamic = "force-dynamic";

const EMAIL_MAX = 254;

/**
 * Captured mail for one address, newest first. For the operator and the
 * end-to-end tests of a deployment that captures mail instead of sending it.
 *
 * Who may call it: only a holder of MAILBOX_SECRET, as a bearer credential.
 * It does not exist (404) unless mail is captured and a mailbox secret is
 * configured, and never in production.
 */
export const GET = route(async (request) => {
  const env = getEnv();
  if (env.stage === "production" || env.emailTransport !== "capture" || env.mailboxSecret === null) {
    throw new AppError("not_found", "Not found.");
  }
  if (!constantTimeEqual(bearerToken(request) ?? "", env.mailboxSecret)) {
    throw new AppError("unauthenticated", "A valid mailbox credential is required.");
  }
  const url = new URL(request.url);
  const to = (url.searchParams.get("to") ?? "").trim().toLowerCase();
  if (to.length === 0 || to.length > EMAIL_MAX || !to.includes("@")) {
    throw new AppError("invalid_input", "Pass the address to read as `to`.", { fields: ["to"] });
  }
  const page = parsePagination(url.searchParams);
  const db = getDb();
  const [total] = await db.select({ n: count() }).from(mailCapture).where(eq(mailCapture.toAddress, to));
  const rows = await db
    .select()
    .from(mailCapture)
    .where(eq(mailCapture.toAddress, to))
    .orderBy(desc(mailCapture.createdAt), desc(mailCapture.id))
    .limit(page.pageSize)
    .offset(page.offset);
  return json(
    listEnvelope(
      rows.map((row) => ({
        id: row.id,
        to: row.toAddress,
        kind: row.kind,
        subject: row.subject,
        text: row.body,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      total?.n ?? 0,
    ),
  );
});
