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
