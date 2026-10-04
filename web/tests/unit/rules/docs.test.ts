import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RULES } from "../../../scripts/check-hosted-rules.mjs";

/**
 * The operator and developer instructions that a wrong sentence would turn
 * into a wrong action: which scan to run, how sign-ups stop, and what to run
 * before a deploy.
 */
const WEB = path.resolve(import.meta.dirname, "../../..");
const README = readFileSync(path.join(WEB, "README.md"), "utf8");
const OPERATIONS = readFileSync(path.join(WEB, "..", "docs", "web", "operations.md"), "utf8");

/** The text of one level-two section, from its heading to the next one. */
function section(markdown: string, heading: RegExp): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## ") && heading.test(line));
  expect(start, `no section ${heading}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("web/README.md", () => {
  const guardRails = section(README, /Repository guard rails/);

  it("gives a scan command that reads only what git would commit", () => {
    expect(guardRails).toContain("git ls-files -z --cached --others --exclude-standard");
  });

  it("does not offer the plain scan of the checkout, which also walks node_modules and .next", () => {
    expect(guardRails).not.toMatch(/^\s*python3? scripts\/public_safety_scan\.py \.\s*$/m);
  });

  it("describes every part of the app the hosted rules check reads, and every rule", () => {
    const gate = section(README, /The hosted rules check/);
    for (const part of ["src/", "public/", "next.config", "vercel.json", "package.json"]) expect(gate).toContain(part);
    for (const rule of RULES) expect(gate).toContain(`\`${rule.id}\``);
  });
});

describe("docs/web/operations.md", () => {
  const rollback = section(OPERATIONS, /Rollback/);
  const deployment = section(OPERATIONS, /Deployment/);

  it("stops sign-ups by removing OPERATOR_NAME and deploying again, not at once", () => {
    const paragraph = rollback.split("\n\n").find((part) => part.includes("OPERATOR_NAME")) ?? "";
    expect(paragraph).toContain("vercel env rm OPERATOR_NAME production");
    expect(paragraph).toContain("vercel deploy --prod --yes");
    expect(paragraph).not.toMatch(/sign-ups at once/);
  });

  it("says a deployment keeps the variables it was built with, also when an older one is promoted", () => {
    expect(rollback).not.toContain("Environment variables are not part of a deployment");
    expect(rollback).toMatch(/keeps the values it was built with/);
    expect(rollback).toMatch(/older deployment[^.]*its own values/);
  });

  it("runs the tests and the hosted rules check before the deploy command", () => {
    const deploy = deployment.indexOf("vercel deploy --prod --yes");
    expect(deploy).toBeGreaterThan(0);
    expect(deployment.indexOf("corepack yarn test")).toBeGreaterThan(0);
    expect(deployment.indexOf("corepack yarn test")).toBeLessThan(deploy);
    expect(deployment.indexOf("node scripts/check-hosted-rules.mjs")).toBeGreaterThan(0);
    expect(deployment.indexOf("node scripts/check-hosted-rules.mjs")).toBeLessThan(deploy);
  });
});

describe("docs/web/infrastructure.md", () => {
  const infrastructure = readFileSync(path.join(WEB, "..", "docs", "web", "infrastructure.md"), "utf8");

  it("names the owner's Vercel team only by a placeholder, never by its slug", () => {
    expect(infrastructure).toContain("`<team-slug>`");
    expect(infrastructure).not.toMatch(/team `(?!<team-slug>`)[^`]+`/);
  });

  it("does not describe resources that belong to the owner's other projects", () => {
    expect(infrastructure).not.toMatch(/another project/);
    expect(infrastructure).not.toMatch(/\b(Supabase|Resend)\b/);
  });
});
