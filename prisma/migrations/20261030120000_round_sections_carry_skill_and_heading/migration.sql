-- A round's section carries the skill and the heading it was graded under.
--
-- Both were read from the assignment's declaration by the section's key. A declaration can lose
-- a key: a section removed and added again, or a re-proposal that could not pair a reworded
-- heading with the section it replaces. Every round graded under the lost key then counted toward
-- no skill and lost its heading, with nothing wrong in the round itself. Copying both onto the
-- round section at creation makes the round self-describing. Re-tagging a declared section offers
-- to rewrite the skill on every round section carrying the same key; a renamed heading is written
-- through without asking, since a heading is presentation.
--
-- Columns are added and nothing is dropped. The backfill fills both from the current declaration
-- for every round section that already carries a key the declaration holds. On a database whose
-- rounds have not been converted yet that is no section at all, and `convert:rounds` writes both
-- as it keys each round; a section whose key is gone stays null, which is what it counted as
-- before this migration.

-- AlterTable
ALTER TABLE "grading_draft_sections"
  ADD COLUMN "heading" TEXT,
  ADD COLUMN "skill_id" UUID;

-- CreateIndex
CREATE INDEX "grading_draft_sections_skill_id_idx" ON "grading_draft_sections"("skill_id");

-- AddForeignKey
ALTER TABLE "grading_draft_sections"
  ADD CONSTRAINT "grading_draft_sections_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: the declared section with the same key, through the round's submission's assignment.
UPDATE "grading_draft_sections" AS section
SET
  "skill_id" = NULLIF(declared.entry ->> 'skillId', '')::uuid,
  "heading" = NULLIF(declared.entry ->> 'heading', '')
FROM
  "grading_drafts" AS draft,
  "submissions" AS submission,
  "assignments" AS assignment,
  -- A declaration that is not a list holds no sections; read as an empty one rather than
  -- letting jsonb_array_elements abort the migration on it.
  LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(assignment."sections") = 'array' THEN assignment."sections" ELSE '[]'::jsonb END
  ) AS declared(entry)
WHERE
  section."grading_draft_id" = draft."id"
  AND draft."submission_id" = submission."id"
  AND submission."assignment_id" = assignment."id"
  AND section."section_key" IS NOT NULL
  AND declared.entry ->> 'key' = section."section_key";
