import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const serverOnlyStub = fileURLToPath(new URL("./tests/setup/server-only-stub.ts", import.meta.url));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // `server-only` throws outside a React Server Components bundle; tests load server modules directly.
    alias: { "server-only": serverOnlyStub },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "tests/parity/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["./tests/setup/global-db.ts"],
          setupFiles: ["./tests/setup/integration-env.ts"],
          fileParallelism: false,
          pool: "forks",
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
