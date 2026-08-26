-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "comments_resolved_at" TIMESTAMPTZ(6),
ADD COLUMN     "comments_resolved_by" UUID;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_comments_resolved_by_fkey" FOREIGN KEY ("comments_resolved_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ===========================================================================
-- Hand-written from here down. `migrate diff` cannot see it.
-- ===========================================================================

-- A resolver with no resolution is nonsense; a resolution whose resolver's
-- account has gone is not. One direction only, because `comments_resolved_by` is
-- ON DELETE SET NULL and a paired constraint would make removing a profile fail
-- on somebody else's settled thread.
ALTER TABLE public."submissions"
  ADD CONSTRAINT "submissions_comments_resolved_by_implies_resolved"
  CHECK ("comments_resolved_at" IS NOT NULL OR "comments_resolved_by" IS NULL);
