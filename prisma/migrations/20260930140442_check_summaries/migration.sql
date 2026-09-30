-- A check for understanding keeps the latest summary of its answers, written by Claude at an
-- instructor's request: what the room's answers have in common, which fellows share each
-- misconception, and what to return to. The fellows are held by profile id, mapped back from the
-- labels the prompt used, so no name went to the model and none can be invented. The metadata
-- column takes the shape the other two `model_metadata` columns use, so `npm run cost` prices it.
--
-- All three columns are nullable, and nothing here writes a row, so the previous release runs
-- unchanged against this and the code rolls back freely.

-- AlterTable
ALTER TABLE "checks_for_understanding" ADD COLUMN     "summary" JSONB,
ADD COLUMN     "summary_at" TIMESTAMPTZ(6),
ADD COLUMN     "summary_model_metadata" JSONB;

-- A third audited action for an operation that costs money, beside DRAFT_GENERATED and TESTS_RUN:
-- one model call over every answer to one check. Recorded before the call, so that counting an
-- actor's recent events is what bounds the next one, the way `lib/audit/rate-limit.ts` does.
--
-- `ALTER TYPE ... ADD VALUE` runs inside the transaction Prisma wraps this file in, which
-- Postgres permits as long as the new value is not *used* in the same transaction. Nothing here
-- writes a row, so this is safe.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CHECK_SUMMARY_GENERATED';
