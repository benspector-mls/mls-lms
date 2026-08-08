/**
 * A connection string that is never connected to.
 *
 * Several modules under test sit in a file that also holds a database write — `deliveryOutcome`
 * and `effectiveSection` live beside `approveDraft`, which imports the client — and
 * `lib/prisma.ts` throws at import time when `DATABASE_URL` is unset. A placeholder is enough,
 * because constructing a `PrismaClient` opens nothing: the pool is built on the first query, and
 * no test here issues one. A test that did would fail to connect, loudly, which is the right
 * outcome for a unit test that reached the database by accident.
 *
 * Deliberately not `.env.local`. These tests must not depend on a developer having one, must not
 * differ between machines, and must never be one typo away from writing to a real database.
 */
process.env.DATABASE_URL ??= "postgresql://unit-tests:unused@127.0.0.1:5432/unused";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
