/**
 * Closes this file's connection pool when its tests are done.
 *
 * Without it the run finishes, reports, and then hangs — Jest waits on the open pool and says only
 * that something asynchronous was not stopped. The `verify:` scripts never needed this, because a
 * script ends when its process does.
 *
 * Safe to do per file only because `jest.integration.setup.mjs` clears the client cached on
 * `globalThis` before each file loads, so the client closed here is the one this file built and
 * nothing else is holding it. The header there records what happened when that was not true.
 *
 * `setupFilesAfterEnv` rather than `globalTeardown`: the latter runs in its own context and would
 * disconnect a different client than the one the tests used.
 */
import { db } from "@/lib/prisma";

afterAll(async () => {
  await db.$disconnect();
});
