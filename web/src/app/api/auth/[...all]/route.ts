import { handleAuthRequest } from "@/server/auth/handler";

// Who may call it: anyone. Each endpoint decides what a caller may do; this
// file only hands the request to the guarded entry point, which refuses unknown
// paths and oversized bodies and answers a generic 500 for anything unexpected.
// The Better Auth instance is resolved per request, so importing this module
// (and `next build`) needs no configuration.
export function GET(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}

export function POST(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}
