-- AlterTable
ALTER TABLE "grading_draft_sections" ADD COLUMN     "instructor_notes" TEXT[] DEFAULT ARRAY[]::TEXT[];

