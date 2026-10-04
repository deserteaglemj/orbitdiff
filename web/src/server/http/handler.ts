import { toErrorResponse } from "./errors";

type Handler<C> = (request: Request, context: C) => Response | Promise<Response>;

/**
 * Wrap an App Router route handler so anything it throws becomes the error
 * envelope. It does no authentication and no origin check: call the guards and
 * assertSameOrigin inside the handler.
 */
export function route<C = unknown>(handler: Handler<C>): (request: Request, context: C) => Promise<Response> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/** JSON response that intermediaries must not store: API responses are per user. */
export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: { "cache-control": "no-store", ...init.headers },
  });
}
