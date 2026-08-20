-- A student's own calendar feed address, so due dates can be subscribed to.
--
-- Purely additive: one nullable column and the unique index behind it. Nothing is renamed,
-- dropped, or backfilled, so this migration cannot lose data. Existing rows get NULL, which is
-- the correct starting state — a token is written the first time a person asks for their link,
-- and most never will.
--
-- The column is the whole of the authorization on `GET /api/calendar/[token]`, because no calendar
-- application sends a cookie. UNIQUE is doing real work rather than documenting an intention: it
-- is the index the route's lookup uses, and it is what makes two profiles landing on one token a
-- failure at the database rather than something the application has to check for and then race.
--
-- **No privilege block, and that is deliberate rather than an omission.** The recipe in
-- prisma.config.ts asks for one on every new *table*; this adds a column to a table that already
-- has one. 20260814024306_revoke_public_grants_project_wide took anon and authenticated off every
-- table in `public`, so `profiles` grants the browser roles nothing and a column arriving on it is
-- closed before it exists. Every read of it goes through tRPC, which reaches Postgres as Prisma —
-- the table owner, restricted by none of this.

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "calendar_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "profiles_calendar_token_key" ON "profiles"("calendar_token");

