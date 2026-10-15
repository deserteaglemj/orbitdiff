import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The proxy sends `script-src 'self' 'nonce-...' 'strict-dynamic'` on every
 * page. With 'strict-dynamic' a browser ignores 'self', so a script runs only
 * when its tag carries the nonce, and Next.js can put the nonce only on a page
 * it renders for the request. A page that is prerendered at build time has no
 * nonce: in production none of its scripts run.
 *
 * So every page, and every not-found page, must be rendered per request: the
 * file itself or a layout above it has to use a request API.
 */
const APP_DIR = fileURLToPath(new URL("../../../src/app", import.meta.url));

/** Files Next.js renders as a document of their own. Route handlers under api/ are not pages. */
const PAGE_FILES = new Set(["page.tsx", "not-found.tsx"]);

/** What makes Next.js render for the request instead of at build time. */
const PER_REQUEST_MARKERS = [
  /\bawait\s+connection\(\)/,
  /\bawait\s+headers\(\)/,
  /\bawait\s+cookies\(\)/,
  /\bawait\s+(?:props\.)?searchParams\b/,
  /\bexport\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
];

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "api" && directory === APP_DIR ? [] : walk(path);
    return [path];
  });
}

/** The source without comments, so a marker that is only mentioned in a comment does not count. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function rendersPerRequest(path: string): boolean {
  const source = code(path);
  return PER_REQUEST_MARKERS.some((marker) => marker.test(source));
}

/** The layouts that wrap a file, from its own directory up to the root layout. */
function layoutsAbove(path: string, files: ReadonlySet<string>): string[] {
  const layouts: string[] = [];
  for (let directory = dirname(path); ; directory = dirname(directory)) {
    const layout = join(directory, "layout.tsx");
    if (files.has(layout)) layouts.push(layout);
    if (directory === APP_DIR) return layouts;
  }
}

const name = (path: string) => relative(APP_DIR, path).split(sep).join("/");

describe("every page is rendered per request, so it can carry the nonce", () => {
  const files = new Set(walk(APP_DIR));
  const pages = [...files].filter((path) => PAGE_FILES.has(path.slice(path.lastIndexOf(sep) + 1))).sort();

  it("finds the pages of the app", () => {
    expect(pages.map(name)).toEqual(expect.arrayContaining(["page.tsx", "not-found.tsx", "(auth)/sign-up/page.tsx"]));
  });

  it("has no page that Next.js would prerender at build time, without a nonce", () => {
    const prerendered = pages.filter(
      (page) => ![page, ...layoutsAbove(page, files)].some((path) => rendersPerRequest(path)),
    );
    expect(prerendered.map(name)).toEqual([]);
  });

  it("does not count a request API that is only mentioned in a comment", () => {
    const commented = "// call await connection() here\n/* or await headers() */\nexport default function Page() {}";
    const stripped = commented.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(PER_REQUEST_MARKERS.some((marker) => marker.test(stripped))).toBe(false);
    expect(PER_REQUEST_MARKERS.some((marker) => marker.test("  await connection();"))).toBe(true);
  });
});
