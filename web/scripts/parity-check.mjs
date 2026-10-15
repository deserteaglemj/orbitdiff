#!/usr/bin/env node
/**
 * Proves that web/tests/parity/golden.json is current: regenerates the vectors
 * from the real Python implementation into a temporary file and compares the
 * bytes with the committed file. Exit status 0 means identical.
 *
 *   corepack yarn parity:check
 *
 * The interpreter must be CPython 3.13. Override the default path with
 * PARITY_PYTHON. `uv run` is always called with --no-project --isolated so
 * nothing is written into the repository.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(web, "..");
const committed = join(web, "tests", "parity", "golden.json");
const python = process.env.PARITY_PYTHON ?? "/usr/local/bin/python3.13";

const scratch = mkdtempSync(join(tmpdir(), "orbitdiff-parity-"));
const fresh = join(scratch, "golden.json");

function cleanUp() {
  try {
    unlinkSync(fresh);
  } catch {
    // The generator may have failed before writing anything.
  }
  try {
    rmdirSync(scratch);
  } catch {
    // Leave the directory if something else was written into it.
  }
}

function firstDifference(left, right) {
  const a = left.split("\n");
  const b = right.split("\n");
  const limit = Math.max(a.length, b.length);
  for (let index = 0; index < limit; index += 1) {
    if (a[index] !== b[index]) {
      return { line: index + 1, committed: a[index], generated: b[index] };
    }
  }
  return null;
}

let status = 1;
try {
  const run = spawnSync(
    "uv",
    [
      "run",
      "--no-project",
      "--isolated",
      "--python",
      python,
      "--with",
      "platformdirs>=4.3,<5",
      "--with",
      "instaloader>=4.15.3,<5",
      "python",
      "web/scripts/parity_golden.py",
      fresh,
    ],
    {
      cwd: repository,
      stdio: "inherit",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  if (run.error) {
    console.error(`parity: could not start uv (${run.error.message})`);
    status = 2;
  } else if (run.status !== 0) {
    console.error(`parity: the generator exited with status ${run.status}`);
    status = 2;
  } else {
    const expected = readFileSync(committed, "utf8");
    const actual = readFileSync(fresh, "utf8");
    if (expected === actual) {
      console.log(`parity: golden.json is current (${expected.length} characters)`);
      status = 0;
    } else {
      const difference = firstDifference(expected, actual);
      console.error("parity: golden.json differs from the Python implementation");
      if (difference) {
        const clip = (text) => (text === undefined ? "<end of file>" : text.slice(0, 200));
        console.error(`  first difference at line ${difference.line}`);
        console.error(`  committed: ${clip(difference.committed)}`);
        console.error(`  generated: ${clip(difference.generated)}`);
      }
      console.error(
        "  regenerate with: uv run --no-project --isolated --python <CPython 3.13> " +
          "--with 'platformdirs>=4.3,<5' --with 'instaloader>=4.15.3,<5' " +
          "python web/scripts/parity_golden.py web/tests/parity/golden.json",
      );
      status = 1;
    }
  }
} finally {
  cleanUp();
}
process.exit(status);
