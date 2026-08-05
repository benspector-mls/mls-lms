-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "submission_instructions" TEXT,
ADD COLUMN     "template_doc_url" TEXT;

-- AlterTable
ALTER TABLE "grading_drafts" ALTER COLUMN "head_sha" DROP NOT NULL;

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "submitted_url" TEXT;

