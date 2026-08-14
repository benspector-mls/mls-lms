import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "./generated/prisma/client";

// Prisma 7 requires an explicit driver adapter — the schema's datasource block
// no longer carries a url.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy it from Supabase → Project Settings → " +
      "Database → Connection string (use the transaction pooler, port 6543).",
  );
}

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// Next.js dev server hot-reloads modules, which would otherwise open a new pool
// on every reload until Postgres refuses connections.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

/**
 * The application's Prisma client, as a type.
 *
 * Named here because a helper that takes a client has to say so, and `typeof
 * import("@/lib/prisma").db` written at each one is the same sentence spelled eleven
 * different times — which is also a value import in type position, so every one of those
 * helpers pulled a `server-only` module into its own graph to borrow a type.
 */
export type Db = typeof db;

/**
 * A client, or a transaction's view of one.
 *
 * Anything that may be called from inside `$transaction` takes this rather than `Db`. That is
 * not a convenience: rows written inside a caller's transaction are invisible to the module's
 * own client, so a function that reaches for `db` directly can only ever be checked up to the
 * guards that refuse before writing. It is what lets the destructive paths be driven against
 * real rows inside a transaction that is then rolled back.
 *
 * Note that a transaction client still carries `$transaction` at runtime even though this type
 * omits it, and calling it opens a *second* transaction on a different connection. Never call it
 * on a `Tx` — use `inTransaction` below, which knows how to tell the two apart.
 */
export type Tx = Db | Prisma.TransactionClient;

/**
 * Runs several writes as one unit, whether or not the caller is already inside a transaction.
 *
 * **The problem this exists for is silent.** A procedure that writes two rows wants them to commit
 * together, so it reaches for `ctx.db.$transaction`. In a request that is correct. Driven from a
 * `verify:*` script — which builds a caller over a transaction so the whole run can be rolled back
 * — `ctx.db` is a transaction client, and the `$transaction` it still carries at runtime opens a
 * *second* transaction on a *different connection*. That connection cannot see the caller's
 * uncommitted rows, so the writes land against a database missing everything the script just set
 * up. Nothing throws about nesting; the failures arrive later and look like authorization bugs.
 *
 * `$disconnect` is the discriminator rather than `$transaction`, because only one of them tells
 * the truth: both clients carry `$transaction`, and only the real one carries `$disconnect`.
 *
 * When the caller is already inside a transaction, the callback simply runs on their client — they
 * own the atomicity, and their rollback covers these writes too. Which is the same trade
 * `lib/grade/approve.ts` makes for its own writes, generalised so every procedure need not.
 */
export async function inTransaction<T>(client: Tx, run: (tx: Tx) => Promise<T>): Promise<T> {
  const isRootClient = typeof (client as Partial<Db>).$disconnect === "function";

  return isRootClient ? (client as Db).$transaction((tx) => run(tx)) : run(client);
}
