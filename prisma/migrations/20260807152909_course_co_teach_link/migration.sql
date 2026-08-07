-- The link that makes whoever opens it a co-instructor of one course.
--
-- Hand-written rather than what `migrate diff` produced. Prisma emits a single
--
--   ALTER TABLE "courses" ADD COLUMN "co_teach_token" TEXT NOT NULL;
--
-- which fails outright on a populated table: every existing row would need the value the
-- statement does not supply. Same shape as the `module_id` migration — add it nullable,
-- give every existing row one, and only then constrain it.
--
-- The value matches what `newJoinToken()` produces in application code: a v4 UUID with its
-- hyphens removed, so a token minted by the migration and one minted by the seed or by
-- `regenerateCoTeachToken` are indistinguishable. `gen_random_uuid()` is per row, which is
-- what the unique index below then has to hold.

ALTER TABLE "courses" ADD COLUMN "co_teach_token" TEXT;

UPDATE "courses"
SET "co_teach_token" = replace(gen_random_uuid()::text, '-', '')
WHERE "co_teach_token" IS NULL;

ALTER TABLE "courses" ALTER COLUMN "co_teach_token" SET NOT NULL;

-- Unique across every course, archived ones included. A token is the whole of the
-- credential, so two courses sharing one would admit an instructor to a cohort nobody
-- offered them. Created after the backfill because it could not be satisfied before it.
CREATE UNIQUE INDEX "courses_co_teach_token_key" ON "courses"("co_teach_token");
