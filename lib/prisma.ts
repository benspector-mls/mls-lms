import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client";

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
