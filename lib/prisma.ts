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
 * omits it, and calling it opens a *second* transaction on a different connection. Decide from
 * whether a client was handed in, never by asking the client what it is.
 */
export type Tx = Db | Prisma.TransactionClient;
