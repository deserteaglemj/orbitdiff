import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";

let server: EmbeddedPostgres | undefined;
/** The end-of-process listeners the Postgres library installed when it was loaded. */
let exitListeners: Array<{ event: "beforeExit" | "exit"; listener: (...args: unknown[]) => void }> = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("no free port"));
      });
    });
  });
}

/**
 * Load the Postgres library and remember the `beforeExit` listeners it adds.
 * Its exit hook ends the process with status 0 from `beforeExit`, which would
 * replace the failing status the test runner set. teardown() removes them
 * once the server has been stopped by hand.
 */
async function loadEmbeddedPostgres(): Promise<typeof EmbeddedPostgres> {
  const events = ["beforeExit", "exit"] as const;
  const before = new Set<unknown>(events.flatMap((event) => process.listeners(event as "exit")));
  const loaded = await import("embedded-postgres");
  exitListeners = events.flatMap((event) =>
    process
      .listeners(event as "exit")
      .filter((listener) => !before.has(listener))
      .map((listener) => ({ event, listener: listener as (...args: unknown[]) => void })),
  );
  return loaded.default;
}

/**
 * Integration tests run against a real Postgres. Set TEST_DATABASE_URL to use an
 * existing server; otherwise a throwaway local server is started for the run.
 */
export async function setup(project: TestProject): Promise<void> {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const Postgres = await loadEmbeddedPostgres();
    const port = await freePort();
    const databaseDir = await mkdtemp(path.join(tmpdir(), "orbitdiff-pg-"));
    server = new Postgres({
      databaseDir,
      user: "orbit",
      password: "orbit",
      port,
      persistent: false,
      onLog: () => undefined,
      onError: () => undefined,
    });
    await server.initialise();
    await server.start();
    await server.createDatabase("orbitdiff_test");
    url = `postgres://orbit:orbit@127.0.0.1:${port}/orbitdiff_test`;
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
  project.provide("databaseUrl", url);
}

export async function teardown(): Promise<void> {
  await server?.stop();
  // The server is stopped, so the hook has nothing left to do. Without it the runner's own status stands.
  for (const { event, listener } of exitListeners) process.removeListener(event, listener);
  exitListeners = [];
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
