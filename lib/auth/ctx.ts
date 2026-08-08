import type { Db } from "../prisma";

/**
 * Just enough of a procedure's context to authorize with.
 *
 * Eight helpers were describing this inline — `{ db: typeof import("@/lib/prisma").db; profile:
 * { id: string; role: string } }` — which is one sentence spelled eight ways, and a value import
 * in type position besides.
 *
 * **Structural on purpose, in both halves.** `db` is the type rather than the module's own
 * client, which is what lets a caller pass a transaction: rows written inside a caller's
 * transaction are invisible to the module's client, so a guard that reached for `db` directly
 * could only ever be checked up to the point where it refuses. And `role` is a plain string
 * rather than the `Role` enum, which would be more precise and would make these helpers callable
 * only by something holding a real profile row — exactly the coupling a structural context
 * avoids.
 *
 * Here in `lib/` rather than in `trpc/init.ts` because the guards that take it live in `lib/`,
 * and a domain module importing a type from the transport layer is the wrong direction.
 * `trpc/init.ts` re-exports it so a router can go on importing everything it needs from `../init`.
 */
export type AuthedCtx = {
  db: Db;
  profile: { id: string; role: string };
};
