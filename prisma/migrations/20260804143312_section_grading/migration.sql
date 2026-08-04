-- Backfills `grading: "ai"` into every existing entry of assignments.sections.
--
-- No schema change: `sections` is a JSON column, so this is data rather than structure.
-- It exists because a section now declares how it is graded, and every section written
-- before that field existed is AI-graded — a rubric, answer keys, and a model call. The
-- alternative was a rule that absent means "ai", remembered forever by every reader; one
-- representation in the database is cheaper than that, and today there are three rows to
-- convert rather than a cohort's worth.
--
-- Idempotent, and safe to run against rows that already carry the field: the WHERE clause
-- only matches entries missing it, and an assignment with an empty sections array is left
-- as an empty array rather than becoming NULL.

UPDATE assignments
SET sections = (
  SELECT jsonb_agg(
    CASE
      WHEN section ? 'grading' THEN section
      ELSE section || '{"grading": "ai"}'::jsonb
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(assignments.sections::jsonb) WITH ORDINALITY AS t(section, ordinality)
)
WHERE jsonb_typeof(sections::jsonb) = 'array'
  AND jsonb_array_length(sections::jsonb) > 0
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(assignments.sections::jsonb) AS entry
    WHERE NOT (entry ? 'grading')
  );
