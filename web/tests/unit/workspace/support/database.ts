import type { TestProject } from "vitest/node";

import { closeDb } from "@/server/db/client";
import { resetEnvForTests } from "@/server/env";

import { setup, teardown } from "../../../setup/global-db";

/**
 * A real Postgres for the page tests in this folder.
 *
 * Tests under tests/unit run without the database the integration project
 * starts, so a file here that calls the pages brings its own: the same
 * throwaway server and the same migrations (tests/setup/global-db.ts), and the
 * same configuration (tests/setup/integration-env.ts). Call it in beforeAll
 * and call what it returns in afterAll.
 *
 * It never uses TEST_DATABASE_URL. That server is shared with the integration
 * files, which run one at a time because each of them empties every table. A
 * file of this project runs next to them, so it needs a server of its own.
 */
export async function startDatabase(): Promise<() => Promise<void>> {
  let url = "";
  const project = {
    provide: (_name: "databaseUrl", value: string) => {
      url = value;
    },
  } as unknown as TestProject;

  const shared = process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  try {
    await setup(project);
  } finally {
    if (shared !== undefined) process.env.TEST_DATABASE_URL = shared;
  }

  // Sets the test configuration. Outside the integration project it has no
  // database address to inject, so that one is set here, after it.
  await import("../../../setup/integration-env");
  process.env.DATABASE_URL = url;
  resetEnvForTests();

  return async () => {
    await closeDb();
    await teardown();
  };
}
