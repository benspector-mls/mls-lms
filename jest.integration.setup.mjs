/**
 * The environment a test that touches the database needs.
 *
 * The mirror image of `jest.setup.mjs`, which sets a connection string that is deliberately never
 * connected to. These tests want the real development database, so they read the same two files
 * the `verify:` scripts read, in the same order: `.env.local` first, then `.env`. dotenv does not
 * overwrite a variable that is already set, so the order is the precedence.
 *
 * Missing credentials raise here rather than at the first query. Without this, a machine with no
 * `.env.local` reports a connection failure inside every test in every suite, and the one fact
 * worth knowing — that there is nothing to connect to — has to be read out of the noise.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set, so the integration tests have no database to run against. " +
      "They read `.env.local`, the same file the verify: scripts read. " +
      "`npm test` is the suite that needs no database.",
  );
}

process.env.DIRECT_URL ??= process.env.DATABASE_URL;

/**
 * A connection pool of this file's own.
 *
 * `lib/prisma.ts` keeps its client on `globalThis` for every environment but production, so that
 * Next's dev server does not open a new pool on each hot reload. `NODE_ENV` is `test` here, so that
 * applies — and `maxWorkers: 1` puts every test file in one worker, which means they would
 * otherwise share one client through that object.
 *
 * Sharing it is what made the suite flaky. The pool has to be closed or Jest hangs at the end of
 * the run waiting on it, and closing a shared one in an `afterAll` closes the pool the *next* file
 * is about to use. Prisma reconnects on demand and usually won the race, so about one run in three
 * lost a whole suite in its `beforeAll` — to `Server has closed the connection`, or to `Unable to
 * start a transaction in the given time` while Supabase's transaction pooler still held the old
 * connection. A whole suite failing at once, intermittently, looks nothing like its cause.
 *
 * This runs before the test file is loaded, so clearing the cache here leaves each file to build
 * the client it then closes: one pool per file, opened and closed by the same file, and no file
 * able to close another's.
 */
delete globalThis.prisma;
