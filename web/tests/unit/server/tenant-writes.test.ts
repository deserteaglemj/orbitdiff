import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SRC = path.join(ROOT, "src");
const USAGE = path.join("src", "server", "services", "usage.ts");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(name) ? [file] : [];
  });
}

/**
 * `bumpUsage` takes a scope key, not a user id, so it is the one counter
 * primitive that does not follow "the user id comes first". It stays inside
 * the usage module: tenant code counts through countImport and
 * countManualReview, which take the owner's id first.
 */
describe("tenant usage counters", () => {
  it("are written through owner-first functions: nothing outside the usage module calls bumpUsage", () => {
    const callers = sourceFiles(SRC)
      .map((file) => path.relative(ROOT, file))
      .filter((file) => file !== USAGE)
      .filter((file) => /\bbumpUsage\b/.test(readFileSync(path.join(ROOT, file), "utf8")));
    expect(callers).toEqual([]);
  });

  it("exist for both tenant counters, with the user id as the first parameter", () => {
    const usage = readFileSync(path.join(ROOT, USAGE), "utf8");
    expect(usage).toMatch(/export async function countImport\(\s*userId: string,/);
    expect(usage).toMatch(/export async function countManualReview\(\s*userId: string,/);
  });

  it("the consent log is appended through the user id, with the executor last", () => {
    const consent = readFileSync(path.join(SRC, "server", "services", "consent.ts"), "utf8");
    expect(consent).toMatch(/export async function appendConsent\(\s*userId: string,/);
    expect(consent).toMatch(/executor: Executor = getDb\(\),?\s*\): Promise<void>/);
  });
});
