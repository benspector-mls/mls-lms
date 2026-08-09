import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createTRPCContext } from "../../../../trpc/init";
import { appRouter } from "../../../../trpc/routers/_app";

/**
 * Long enough for the slowest thing a procedure does, said out loud rather than inherited.
 *
 * Almost everything here answers in milliseconds. `gradingDrafts.generate` does not: it runs the
 * student's test suite in a sandbox capped at 120 seconds, then makes a model call per section
 * measured at 27 to 40 — so a two-section assignment can legitimately take three minutes, and it
 * is awaited inside the request on purpose, because somebody is watching the button.
 *
 * Relying on the platform default meant a change of default could cut a report off mid-run, and
 * the failure would look like a model error rather than a timeout. Generating reports in batches
 * makes that a question of when rather than whether, since it turns one such request into twenty.
 */
export const maxDuration = 300;

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: createTRPCContext,
  });

export { handler as GET, handler as POST };
