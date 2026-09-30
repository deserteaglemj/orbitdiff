/**
 * A throwaway Postgres for a local development session, started with the same
 * embedded-postgres package the integration tests use.
 *
 *   corepack yarn tsx tests/helpers/dev-postgres.ts 5439
 *
 * It prints the connection URL, then runs until it receives SIGINT or SIGTERM.
 * On exit the server stops and its data directory is removed. Nothing is
 * written into the repository. The user and password are fixed, local, and not
 * secret: the server listens on 127.0.0.1 only and holds no real data.
 *
 * Apply the schema once it is up:
 *
 *   DATABASE_URL=<printed url> corepack yarn db:migrate
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import EmbeddedPostgres from "embedded-postgres";

const DATABASE = "orbitdiff_dev";

async function main(): Promise<void> {
  const port = Number(process.argv[2] ?? "5439");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Pass a port from 1024 to 65535.");
  }
  const databaseDir = await mkdtemp(path.join(tmpdir(), "orbitdiff-dev-pg-"));
  const server = new EmbeddedPostgres({
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
  await server.createDatabase(DATABASE);
  console.log(`dev-postgres: ready at postgres://orbit:orbit@127.0.0.1:${port}/${DATABASE}`);

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await server.stop();
    console.log("dev-postgres: stopped");
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  // Keep the process alive until a signal arrives.
  setInterval(() => undefined, 60_000);
}

main().catch((error: unknown) => {
  console.error("dev-postgres: failed", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
