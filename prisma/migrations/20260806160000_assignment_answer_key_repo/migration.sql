-- An assignment names the repository its reference solutions live in, rather than every
-- assignment in the program sharing the one named by GRADING_ASSETS_REPO.
--
-- Two changes, and the second is why this is hand-written. The column is the easy half.
-- The paths in `sections[].answerKeyPaths` were relative to the `answer-keys/` directory
-- of that one repository, and they now mean paths within whatever repository the
-- assignment names — at any depth, because a private repository an instructor creates
-- for one cohort has no reason to have an `answer-keys/` directory at its root. So every
-- stored path gains the prefix it used to have applied to it on the way out.
--
-- Doing it here rather than leaving the prefix in the reading code is the point: a path
-- in the column is now a path in the repository, with nothing between what an instructor
-- ticked and what grading reads.

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN "answer_key_repo" TEXT;

-- Backfill: every existing repository assignment keeps reading the repository it already
-- read.
--
-- The name is written out rather than read from GRADING_ASSETS_REPO, because a migration
-- cannot see the environment — and it should not, since what is correct here is not
-- whatever that variable happens to say now but the repository the stored paths were
-- written against. A deployment that has been grading against a different one has to
-- adjust this before running it.
UPDATE "assignments"
   SET "answer_key_repo" = 'The-Marcy-Lab-School/swe-assignment-grading-guides'
 WHERE "kind" = 'REPO';

-- Every answer key path gains the `answer-keys/` prefix that reading used to add.
--
-- `normalized.paths` exists so the rest of the statement can assume an array. A manual
-- section has no `answerKeyPaths` key at all, and `jsonb_array_elements_text` on a
-- missing key is an error rather than an empty set — guarding with a CASE in a lateral is
-- what makes the whole expression safe for every row regardless of what its sections hold.
--
-- The LIKE test makes this idempotent: a path already under `answer-keys/` is left alone,
-- so running it twice cannot produce `answer-keys/answer-keys/…`.
UPDATE "assignments"
   SET "sections" = (
     SELECT jsonb_agg(
       CASE
         WHEN jsonb_array_length(normalized.paths) = 0 THEN t.entry
         ELSE jsonb_set(t.entry, '{answerKeyPaths}', (
           SELECT jsonb_agg(
             to_jsonb(
               CASE WHEN p.path LIKE 'answer-keys/%' THEN p.path
                    ELSE 'answer-keys/' || p.path END
             )
             ORDER BY p.position
           )
           FROM jsonb_array_elements_text(normalized.paths)
                WITH ORDINALITY AS p(path, position)
         ))
       END
       ORDER BY t.ordinality
     )
     FROM jsonb_array_elements("assignments"."sections"::jsonb)
          WITH ORDINALITY AS t(entry, ordinality)
     CROSS JOIN LATERAL (
       SELECT CASE
                WHEN jsonb_typeof(t.entry -> 'answerKeyPaths') = 'array'
                THEN t.entry -> 'answerKeyPaths'
                ELSE '[]'::jsonb
              END AS paths
     ) AS normalized
   )
 WHERE jsonb_typeof("sections"::jsonb) = 'array'
   AND jsonb_array_length("sections"::jsonb) > 0
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements("assignments"."sections"::jsonb) AS entry
       CROSS JOIN LATERAL (
         SELECT CASE
                  WHEN jsonb_typeof(entry -> 'answerKeyPaths') = 'array'
                  THEN entry -> 'answerKeyPaths'
                  ELSE '[]'::jsonb
                END AS paths
       ) AS normalized
       CROSS JOIN LATERAL jsonb_array_elements_text(normalized.paths) AS p(path)
      WHERE p.path NOT LIKE 'answer-keys/%'
   );
