import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { expect, it } from "vitest";

/**
 * Every gate that runs this suite trusts the exit status of the command, not the
 * printed summary. The integration project loads a global setup that starts a
 * throwaway Postgres, and the library behind it hooks the end of the process. This
 * file pins that a red integration run still ends with a failing status.
 *
 * It works in two roles. A normal run defines only the outer test, which starts a
 * second run of this same file with PROBE_FLAG set. That inner run defines only the
 * probe, which fails on purpose.
 */
const PROBE_FLAG = "ORBITDIFF_EXIT_PROBE";
const PROBE_NAME = "exit status probe fails on purpose";
const WEB_ROOT = path.resolve(import.meta.dirname, "../../..");
const THIS_FILE = path.relative(WEB_ROOT, import.meta.filename);

interface RunResult {
  status: number | null;
  output: string;
}

function runProbe(): Promise<RunResult> {
  const require = createRequire(import.meta.url);
  const entry = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  // The inner run must look like a fresh command: drop what the outer runner set for its workers.
  const env: NodeJS.ProcessEnv = { ...process.env, [PROBE_FLAG]: "1", NO_COLOR: "1" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST")) delete env[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "run", "--project", "integration", THIS_FILE], {
      cwd: WEB_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, output: Buffer.concat(chunks).toString("utf8") }));
  });
}

if (process.env[PROBE_FLAG] === "1") {
  it(PROBE_NAME, () => {
    expect("red").toBe("green");
  });
} else {
  it("a failing integration test makes the test command exit with a failing status", async () => {
    const result = await runProbe();

    // The inner run really ran the probe and really reported it as failed.
    expect(result.output).toContain(PROBE_NAME);
    expect(result.output).toMatch(/Tests\s+1 failed/);
    expect(
      result.status,
      "the run reported a failed test, so the command must not end with status 0 (see tests/setup/global-db.ts)",
    ).toBe(1);
  }, 180_000);
}
