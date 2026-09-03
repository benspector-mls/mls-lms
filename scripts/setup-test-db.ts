/**
 * Builds the disposable local database the integration tests can run against.
 *
 *   npm run db:test:reset
 *
 * **Why there is one at all.** The integration suites otherwise run against the development
 * Supabase project, which means they depend on what somebody happened to seed and on rows that
 * accumulate as the application is used. Two `verify:` scripts had been measuring nothing for weeks
 * for exactly that reason. A database built from the migrations is the same on every machine and on
 * a build server, and it is the thing that makes the suite safe to hand to somebody else.
 *
 * **Why the seed is not used to fill it.** `prisma/seed.ts` looks up profiles that a real GitHub
 * sign-in created, and there is no signing in to a local Postgres. So this script creates the
 * schema and nothing else: every suite makes the rows it needs inside its own transaction, which is
 * what lets the same suite run against either database.
 *
 * **What replaces Supabase.** Supabase owns the `auth` schema, and the migrations reference it —
 * `profiles` has a foreign key to `auth.users`, a trigger on it creates a profile on sign-up, and
 * the row level security policies call `auth.uid()`. `prisma.config.ts` already carries a stub of
 * exactly that for the shadow database used to diff migrations, and this reads it from there rather
 * than keeping a second copy that would drift. The few columns beyond it are named below.
 */
import { Client } from "pg";
import { spawnSync } from "node:child_process";

import prismaConfig from "../prisma.config";
import { testDatabaseUrl } from "./test-db-url.mjs";

/**
 * Where the test database lives, and the only place this script will act on.
 *
 * A local default, because the point of it is to be disposable. `TEST_DATABASE_URL` overrides it
 * for somebody whose Postgres is elsewhere.
 */
const url = new URL(testDatabaseUrl());

/**
 * The refusal that makes this safe to run.
 *
 * This script DROPs a database. Everything else destructive in this repository is a `:deployment`
 * script guarded by a hook, and the reason those exist is that a connection string is one paste
 * away from naming the wrong thing. Two conditions have to hold: the host is this machine, and the
 * database name says it is a test database. A production or development URL satisfies neither.
 */
function refuseAnythingButALocalTestDatabase(): void {
  const host = url.hostname;
  const name = url.pathname.replace(/^\//, "");
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (!local || !name.endsWith("_test")) {
    console.error(
      `Refusing to touch ${host}/${name}.\n\n` +
        "This script drops and recreates a database, so it acts only on a host of this machine " +
        "and only on a database whose name ends in `_test`. Set TEST_DATABASE_URL to something " +
        "like postgresql://localhost:5432/mls_lms_test.",
    );
    process.exit(1);
  }
}

/** The `auth` schema, as much of it as the migrations and the suites need. */
async function createAuthSchema(client: Client): Promise<void> {
  const stub = prismaConfig.migrations?.initShadowDb;

  if (typeof stub !== "string" || !stub.includes("auth.users")) {
    throw new Error(
      "prisma.config.ts no longer exposes an initShadowDb stub creating auth.users. " +
        "It is what this script builds the auth schema from; update this script alongside it.",
    );
  }

  await client.query(stub);

  /*
    The columns a real `auth.users` has and the shadow stub does not.

    The stub exists to let migrations replay, and migrations touch none of these. The suites do:
    creating a fellow or an instructor inserts a row here and lets the on-signup trigger make the
    profile, which is the path a real account arrives by, and that insert names the columns
    Supabase's own table requires. Added rather than folded into the stub, so the stub goes on
    saying exactly what a migration needs.
  */
  await client.query(`
    ALTER TABLE auth.users
      ADD COLUMN IF NOT EXISTS instance_id uuid,
      ADD COLUMN IF NOT EXISTS aud varchar(255),
      ADD COLUMN IF NOT EXISTS role varchar(255),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz;
  `);
}

async function main(): Promise<void> {
  refuseAnythingButALocalTestDatabase();

  const name = url.pathname.replace(/^\//, "");
  const admin = new URL(url.toString());
  admin.pathname = "/postgres";

  console.log(`Rebuilding ${url.hostname}/${name}`);

  const server = new Client({ connectionString: admin.toString() });
  await server.connect();
  try {
    // Anything still attached would make the DROP fail, and a stale connection from a previous run
    // is the ordinary case rather than the exception.
    await server.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );
    await server.query(`DROP DATABASE IF EXISTS "${name}"`);
    await server.query(`CREATE DATABASE "${name}"`);
  } finally {
    await server.end();
  }

  const created = new Client({ connectionString: url.toString() });
  await created.connect();
  try {
    await createAuthSchema(created);
  } finally {
    await created.end();
  }

  console.log("Applying migrations");

  /*
    `migrate deploy` replays the SQL in prisma/migrations and nothing else, which is what makes it
    the right command here as well as against the deployment. Both variables are set because the
    schema's datasource reads DIRECT_URL for migrations and DATABASE_URL for everything else, and a
    variable left over from `.env.local` would point half of this at Supabase.
  */
  const applied = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      DIRECT_URL: url.toString(),
    },
  });

  if (applied.status !== 0) process.exit(applied.status ?? 1);

  console.log(`\nReady. Run the suites against it with:\n  npm run test:integration:local`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
