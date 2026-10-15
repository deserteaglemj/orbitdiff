import { requireUser } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { exportAccount } from "@/server/services/account";

export const dynamic = "force-dynamic";

const CHUNK_BYTES = 64 * 1024;

/** Send the bytes as a stream, so a large export is not held to a single response body limit. */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
      }
      controller.close();
    },
  });
}

/**
 * Download everything stored for the signed-in user as one JSON file.
 * Who may call it: a signed-in, verified, active user, for their own account
 * only; there is no id to pass. Onboarding is not required, so a user can
 * always take their data with them. No password hash, sign-in credential, or
 * verification value is included.
 */
export const GET = route(async (request) => {
  const user = await requireUser(request.headers);
  const now = new Date();
  const bytes = new TextEncoder().encode(JSON.stringify(await exportAccount(user.id, now)));
  return new Response(streamOf(bytes), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="orbitdiff-export-${now.toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
