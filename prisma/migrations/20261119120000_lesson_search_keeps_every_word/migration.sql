-- Hand-written: `migrate diff` sees the column's expression but not the text search configuration
-- it names.

-- Postgres's English configuration leaves out stop words — `while`, `for`, `if`, `not`, `and`,
-- `or`, `in`, `is` — so they are in neither the stored terms nor a query. In lessons about Python
-- those are the words a fellow searches for, and "while loop" would find every section about any
-- loop. This configuration is English with the same stemming, so "loops" still finds "loop", and
-- no stop words.
CREATE TEXT SEARCH DICTIONARY public.english_stem_keep_all (TEMPLATE = snowball, LANGUAGE = english);
CREATE TEXT SEARCH CONFIGURATION public.lesson_text (COPY = pg_catalog.english);
ALTER TEXT SEARCH CONFIGURATION public.lesson_text
  ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
  WITH public.english_stem_keep_all;

-- The generated column is rebuilt with it. Postgres computes the new column for every section
-- already stored, so nothing has to be copied from GitHub again.
DROP INDEX "lesson_sections_search_idx";
ALTER TABLE "lesson_sections" DROP COLUMN "search";
ALTER TABLE "lesson_sections"
  ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('public.lesson_text', "heading" || ' ' || "text")) STORED;
CREATE INDEX "lesson_sections_search_idx" ON "lesson_sections" USING GIN ("search");
