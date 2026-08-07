-- Exactly one primary instructor per course.
--
-- `is_primary` marks whoever owns the cohort, and until now it carried a uniqueness rule
-- that nothing stated: two rows on one course were representable and the schema allowed it.
-- Transferring ownership is what would produce them, since it clears one row and sets
-- another — and two owners is two people who can each archive the cohort and neither of whom
-- can be removed, failing quietly because every reader takes the first row it finds.
--
-- Prisma cannot express a partial index, so this is hand-written and absent from
-- schema.prisma. `migrate diff` cannot see it either, so it survives rather than being
-- proposed for removal by the next schema change.

-- Demote any extras first, keeping the earliest, so the index below can be created on a
-- database that already holds a course with two of them. There is not known to be one; the
-- point is that this migration must not be the thing that fails on deploy.
UPDATE "course_instructors" AS extra
SET "is_primary" = false
WHERE extra."is_primary"
  AND extra."id" <> (
    SELECT earliest."id"
    FROM "course_instructors" AS earliest
    WHERE earliest."course_id" = extra."course_id"
      AND earliest."is_primary"
    ORDER BY earliest."created_at" ASC, earliest."id" ASC
    LIMIT 1
  );

CREATE UNIQUE INDEX "course_instructors_one_primary_per_course"
  ON "course_instructors" ("course_id") WHERE "is_primary";
