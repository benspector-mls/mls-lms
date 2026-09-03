/**
 * Where the disposable local test database lives.
 *
 * Two things read this and they must agree: `scripts/setup-test-db.ts`, which builds the database,
 * and `jest.integration.setup.mjs`, which points the suites at it. If they disagreed the suites
 * would run against a database nobody had migrated, and the failure would be every test in every
 * file rather than anything to do with the code.
 *
 * The user is spelled out rather than left off. `psql` falls back to the operating system account
 * when a connection string omits it, and Postgres.app's default installation relies on that — but
 * Prisma does not, and the failure is `P1010: User was denied access on the database (not
 * available)`, which names neither the user nor the database and reads like a problem on the
 * server.
 *
 * The name ends in `_test` because `setup-test-db.ts` drops the database it is given and refuses
 * any name that does not.
 */
export function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const user = process.env.PGUSER ?? process.env.USER ?? "postgres";
  return `postgresql://${encodeURIComponent(user)}@localhost:5432/mls_lms_test`;
}
