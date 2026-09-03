/**
 * One check before the run, so a missing database says so once.
 *
 * Without it, a checkout that has not built the local database yet reports the same connection
 * failure inside every test of every file, and the one fact worth knowing — that there is nothing
 * to connect to and one command builds it — has to be read out of a hundred stack traces.
 *
 * `globalSetup` rather than `setupFiles`: this runs once for the whole run rather than once per
 * file, and it may be asynchronous, which a `setupFiles` module compiled to CommonJS may not.
 */
import { config as loadEnv } from "dotenv";

import { testDatabaseUrl } from "./scripts/test-db-url.mjs";

export default async function checkTheDatabaseIsThere() {
  if (!process.env.MLS_TEST_DB) {
    // The Supabase run reads `.env.local`, and the per-file setup raises if it names nothing.
    return;
  }

  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ quiet: true });

  const url = testDatabaseUrl();
  const { Client } = await import("pg");
  const probe = new Client({ connectionString: url, connectionTimeoutMillis: 5_000 });

  try {
    await probe.connect();
    await probe.end();
  } catch (err) {
    throw new Error(
      `Cannot reach the local test database at ${url}.\n\n` +
        "Build it with:  npm run db:test:reset\n\n" +
        "It needs a Postgres server running on this machine. To run against the development " +
        "Supabase project instead, use npm run test:integration:supabase.\n\n" +
        `The connection failed with: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
