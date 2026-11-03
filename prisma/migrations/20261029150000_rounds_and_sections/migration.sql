-- A grading round is a summary with no score and one section per scored unit of the assignment.
--
-- What describes the whole round moves onto `grading_drafts`: the summary the student reads
-- first, the flags, the model's notes and confidence, and the process note. A section becomes one
-- declared unit — a question, an exercise, a criterion — carrying the declared section's key and
-- label, its score, its feedback, and the model's reasoning for it.
--
-- Columns are added and nothing is dropped. The previous release keeps reading and writing the
-- section-level columns while `convert:rounds` rewrites every round into the new shape; those
-- columns are dropped in a later release once nothing reads them.

-- AlterTable
ALTER TABLE "grading_drafts"
  ADD COLUMN "summary_markdown" TEXT,
  ADD COLUMN "edited_summary_markdown" TEXT,
  ADD COLUMN "flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "instructor_notes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "confidence" "Confidence",
  ADD COLUMN "submission_process_note" TEXT;

-- AlterTable
ALTER TABLE "grading_draft_sections"
  ADD COLUMN "section_key" TEXT,
  ADD COLUMN "label" TEXT,
  ADD COLUMN "model_reasoning" TEXT;
