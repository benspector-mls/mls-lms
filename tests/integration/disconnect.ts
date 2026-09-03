/**
 * Closes the connection pool when a file's tests are done.
 *
 * Without this the run finishes, reports, and then hangs — Jest waits on the open pool and says
 * only that something asynchronous was not stopped. The scripts never needed it because a script
 * ends when its process does.
 *
 * `setupFilesAfterEnv` rather than `globalTeardown`: the latter runs in its own context and would
 * disconnect a different client than the one the tests used.
 */
import { db } from "@/lib/prisma";

afterAll(async () => {
  await db.$disconnect();
});
