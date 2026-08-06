-- An assignment names the *folder* its reference solutions are in, not the files.
--
-- Every file under that folder is the reference set. The list of individual paths this
-- replaces held the same information right up until somebody added a reference solution to
-- the folder, at which point the stored list was quietly wrong and nothing said so.
--
-- Hand-written, because the backfill has to derive one directory from a list of paths and
-- then prove it derived the right one.

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN "answer_key_dir" TEXT;

-- Backfill: the shortest directory among the paths each assignment names.
--
-- Shortest rather than a segment-by-segment common prefix, because answer keys only ever nest
-- *inside* an assignment's own folder — `swe-1-3-node-modules` keeps two of its three under
-- `madlib-challenge/` — so the shallowest directory contains all of them. That is an assumption
-- about the data rather than a rule, which is why the assertion below exists.
WITH dirs AS (
    SELECT a."id",
           regexp_replace(p.path, '/[^/]*$', '') AS dir
      FROM "assignments" a
      CROSS JOIN LATERAL jsonb_array_elements(a."sections"::jsonb) AS s(entry)
      CROSS JOIN LATERAL (
        SELECT CASE
                 WHEN jsonb_typeof(s.entry -> 'answerKeyPaths') = 'array'
                 THEN s.entry -> 'answerKeyPaths'
                 ELSE '[]'::jsonb
               END AS arr
      ) AS normalized
      CROSS JOIN LATERAL jsonb_array_elements_text(normalized.arr) AS p(path)
),
shortest AS (
    SELECT DISTINCT ON ("id") "id", dir
      FROM dirs
     ORDER BY "id", length(dir), dir
)
UPDATE "assignments" a
   SET "answer_key_dir" = shortest.dir
  FROM shortest
 WHERE shortest."id" = a."id";

-- Every path has to be inside the directory that was derived for its assignment. If one is
-- not, the shortest directory was not the common one and this migration would silently narrow
-- what grading reads — so it stops instead.
DO $$
DECLARE offenders int;
BEGIN
    SELECT count(*) INTO offenders
      FROM (
        SELECT a."answer_key_dir" AS dir, p.path
          FROM "assignments" a
          CROSS JOIN LATERAL jsonb_array_elements(a."sections"::jsonb) AS s(entry)
          CROSS JOIN LATERAL (
            SELECT CASE
                     WHEN jsonb_typeof(s.entry -> 'answerKeyPaths') = 'array'
                     THEN s.entry -> 'answerKeyPaths'
                     ELSE '[]'::jsonb
                   END AS arr
          ) AS normalized
          CROSS JOIN LATERAL jsonb_array_elements_text(normalized.arr) AS p(path)
         WHERE a."answer_key_dir" IS NOT NULL
      ) AS checked
     WHERE checked.path NOT LIKE checked.dir || '/%';

    IF offenders > 0 THEN
        RAISE EXCEPTION
            'answer_key_dir backfill is wrong: % answer key path(s) are not inside the '
            'directory derived for their assignment. The shortest directory is not the '
            'common one for this data.', offenders;
    END IF;
END $$;

-- A repository assignment that named a repository but no keys at all gets the repository root,
-- which is what "everything in it" means when nothing narrower was said. Left NULL for the
-- kinds with no repository, where there are no reference solutions to have.
UPDATE "assignments"
   SET "answer_key_dir" = ''
 WHERE "answer_key_dir" IS NULL
   AND "answer_key_repo" IS NOT NULL;

-- The per-file lists come out of `sections`, now that the directory says the same thing.
UPDATE "assignments"
   SET "sections" = (
     SELECT jsonb_agg((t.entry - 'answerKeyPaths') ORDER BY t.ordinality)
       FROM jsonb_array_elements("assignments"."sections"::jsonb)
            WITH ORDINALITY AS t(entry, ordinality)
   )
 WHERE jsonb_typeof("sections"::jsonb) = 'array'
   AND jsonb_array_length("sections"::jsonb) > 0
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements("assignments"."sections"::jsonb) AS entry
      WHERE entry ? 'answerKeyPaths'
   );
