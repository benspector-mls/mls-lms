-- A fellow's record keeps preparation summaries: Claude's reading of the parts of the record a
-- coach chooses, written for that coach before a conversation and never shown to the fellow. One
-- row per generation, and the newest is the current one; each generation reads the newest row and
-- then only what is new since it, from the watermark in `covered_through`. The metadata column
-- takes the shape the other `model_metadata` columns use, so `npm run cost` prices it.
--
-- Entirely additive. The previous release never reads this table or these enum values, so it runs
-- unchanged against this and the code rolls back freely.

-- The preparation summary's three audited acts. GENERATED is the fourth operation that costs
-- money, recorded before the call so `lib/audit/rate-limit.ts` can count it.
--
-- `ALTER TYPE ... ADD VALUE` runs inside the transaction Prisma wraps this file in, which
-- Postgres permits as long as the new value is not *used* in the same transaction. Nothing here
-- writes a row, so this is safe.
ALTER TYPE "AuditAction" ADD VALUE 'COACHING_SUMMARY_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'COACHING_SUMMARY_EDITED';
ALTER TYPE "AuditAction" ADD VALUE 'COACHING_SUMMARY_DELETED';

-- CreateTable
CREATE TABLE "coaching_summaries" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "themes" JSONB NOT NULL DEFAULT '[]',
    "covered_through" JSONB NOT NULL,
    "inputs" TEXT[],
    "focus" TEXT,
    "author_id" UUID,
    "edited_at" TIMESTAMPTZ(6),
    "model_metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coaching_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coaching_summaries_enrollment_id_created_at_idx" ON "coaching_summaries"("enrollment_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "coaching_summaries" ADD CONSTRAINT "coaching_summaries_enrollment_id_program_id_fkey" FOREIGN KEY ("enrollment_id", "program_id") REFERENCES "enrollments"("id", "program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_summaries" ADD CONSTRAINT "coaching_summaries_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written from here down. `migrate diff` cannot see any of it, so it survives rather than
-- being proposed for removal on the next migration.

-- The same caps the zod inputs put on the body and the focus — `SUMMARY_BODY_MAX_LENGTH` and
-- `SUMMARY_FOCUS_MAX_LENGTH` in lib/coaching.ts — held by the database as well, because a script
-- does not run the application's code. A summary needs words, and it read at least one part of
-- the record.
ALTER TABLE public."coaching_summaries"
  ADD CONSTRAINT coaching_summaries_body_length
  CHECK (char_length("body") BETWEEN 1 AND 20000);

ALTER TABLE public."coaching_summaries"
  ADD CONSTRAINT coaching_summaries_focus_length
  CHECK ("focus" IS NULL OR char_length("focus") <= 500);

ALTER TABLE public."coaching_summaries"
  ADD CONSTRAINT coaching_summaries_inputs_present
  CHECK ("inputs" IS NOT NULL AND cardinality("inputs") >= 1);

-- Reached only through the application's own connection, like every other table here. A summary
-- is staff writing about a fellow, read only through procedures that check the reader instructs
-- the fellow's program.
REVOKE ALL ON TABLE public."coaching_summaries" FROM anon, authenticated;
ALTER TABLE public."coaching_summaries" ENABLE ROW LEVEL SECURITY;
