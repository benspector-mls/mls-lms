-- AlterEnum
ALTER TYPE "GradingDraftStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "grading_drafts" ADD COLUMN     "approved_at" TIMESTAMPTZ(6),
ADD COLUMN     "approved_by" UUID,
ADD COLUMN     "posted_pr_comment_id" BIGINT;

-- AlterTable
ALTER TABLE "submissions" DROP COLUMN "posted_pr_comment_id";

-- AddForeignKey
ALTER TABLE "grading_drafts" ADD CONSTRAINT "grading_drafts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

