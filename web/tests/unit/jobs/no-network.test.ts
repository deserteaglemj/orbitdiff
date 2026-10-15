import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const JOBS = path.join(ROOT, "src/server/jobs");
const ROUTES = [
  path.join(ROOT, "src/app/api/jobs/tick/route.ts"),
  path.join(ROOT, "src/app/api/profiles/[id]/review/route.ts"),
];

/** Anything that could open a connection to another host, or name one. */
const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  ["fetch call", /\bfetch\s*\(/],
  ["network module import", /["'](?:node:)?(?:http|https|http2|net|tls|dgram|dns)["']/],
  ["HTTP client package", /["'](?:undici|axios|got|node-fetch|ws)["']/],
  ["browser network API", /\b(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/],
  ["child process", /child_process/],
  ["Instagram or Meta host", /instagram\.com|cdninstagram|facebook\.com|fbcdn/i],
  ["reference to the local collector", /instaloader/i],
  ["absolute URL", /https?:\/\//],
];

function sources(): string[] {
  const jobs = readdirSync(JOBS)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => path.join(JOBS, name));
  return [...jobs, ...ROUTES];
}

describe("the job runtime source", () => {
  it("covers the worker, the handlers, the tick, and both routes", () => {
    const names = sources().map((file) => path.relative(ROOT, file));
    for (const expected of ["worker.ts", "handlers.ts", "tick.ts", "queue.ts", "retention.ts"]) {
      expect(names).toContain(path.join("src/server/jobs", expected));
    }
    expect(names).toHaveLength(readdirSync(JOBS).length + ROUTES.length);
  });

  it.each(FORBIDDEN)("contains no %s", (_label, pattern) => {
    const offenders = sources().filter((file) => pattern.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });
});
