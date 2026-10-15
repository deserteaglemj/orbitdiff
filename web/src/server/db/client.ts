import "server-only";

import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Pool } from "pg";

import { getEnv } from "@/server/env";
import { logError } from "@/server/http/log";

import * as schema from "./schema";

type Schema = typeof schema;

/** The Drizzle database over the shared pg Pool. `$client` is the Pool. */
export type Database = NodePgDatabase<Schema> & { $client: Pool };

/**
 * Anything that can run queries: the database itself or an open transaction.
 * Services take an Executor so callers can compose them inside one transaction.
 */
export type Executor = PgDatabase<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

const MAX_CONNECTIONS = 5;

interface Holder {
  pool: Pool;
  db: Database;
}

// Kept on globalThis so a hot reload in development reuses the pool instead of leaking one per reload.
const store = globalThis as typeof globalThis & { __orbitdiffDb?: Holder };

/** One pool per server instance, created on first use. */
export function getDb(): Database {
  if (!store.__orbitdiffDb) {
    const pool = new Pool({
      connectionString: getEnv().databaseUrl,
      max: MAX_CONNECTIONS,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    // An idle client can fail at any time; without a listener that would crash the process.
    pool.on("error", (error) => logError("db", error));
    store.__orbitdiffDb = { pool, db: drizzle({ client: pool, schema }) };
  }
  return store.__orbitdiffDb.db;
}

/** Close the pool. The next getDb() opens a new one. */
export async function closeDb(): Promise<void> {
  const holder = store.__orbitdiffDb;
  store.__orbitdiffDb = undefined;
  await holder?.pool.end();
}
