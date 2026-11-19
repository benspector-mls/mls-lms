-- Hand-written. `migrate diff` writes the new column but not the generated one it feeds, nor the
-- update that refills it.

-- A section's code, apart from its prose: the lines of its fenced blocks and its `inline code`.
ALTER TABLE "lesson_sections" ADD COLUMN "code" TEXT NOT NULL DEFAULT '';

-- The search terms, rebuilt from three parts. The code is read with `lesson_text`, which keeps
-- `for`, `if` and `and` because there they are Python. The heading and the prose are read with
-- Postgres's English configuration, which leaves them out because there they are "Code Fences for
-- Blocks of Code" and "for example" — so a search for `for` finds loops rather than every sentence
-- that uses the word. Weighted heading, then code, then prose, so `ts_rank` puts a heading match
-- first.
DROP INDEX "lesson_sections_search_idx";
ALTER TABLE "lesson_sections" DROP COLUMN "search";
ALTER TABLE "lesson_sections"
  ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', "heading"), 'A')
    || setweight(to_tsvector('public.lesson_text', "code"), 'B')
    || setweight(to_tsvector('english', "text"), 'C')
  ) STORED;
CREATE INDEX "lesson_sections_search_idx" ON "lesson_sections" USING GIN ("search");

-- Every stored section has no code yet. Forgetting each lesson's file hash makes the next sync read
-- every lesson again and store its sections with their code; nothing else about a lesson changes.
UPDATE "lessons" SET "blob_sha" = '';
