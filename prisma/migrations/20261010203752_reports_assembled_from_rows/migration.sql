-- AlterTable
ALTER TABLE "grading_draft_sections" ADD COLUMN     "edited_rubric_items" JSONB,
ADD COLUMN     "edited_summary_markdown" TEXT,
ADD COLUMN     "summary_markdown" TEXT;

