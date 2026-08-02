-- AlterTable
ALTER TABLE "grading_draft_sections" ADD COLUMN     "edited_at" TIMESTAMPTZ(6),
ADD COLUMN     "edited_by" UUID,
ADD COLUMN     "edited_report_markdown" TEXT,
ADD COLUMN     "edited_score_earned" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "grading_draft_sections" ADD CONSTRAINT "grading_draft_sections_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

