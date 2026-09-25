-- The courses of a program are ordered by hand, by the program's owner.
--
-- Every list of them was in creation order, which made the order an accident of which course
-- somebody happened to add first — a program runs four courses at once, and the one a fellow
-- should open first is neither the oldest nor the one whose name sorts first.
--
-- `position` is the column `course_units` and `resources` already carry, for the same reason and
-- with the same rules: dense from zero within its parent, assigned by the server, and deliberately
-- not unique, because `reorder` rewrites a whole sequence in one statement and a unique constraint
-- would refuse the intermediate states that statement passes through.
--
-- No index on `(program_id, position)`, unlike those two. A program holds a handful of courses and
-- `courses_program_id_idx` already narrows to them; a second index would be maintained on every
-- write to earn nothing on a sort of four rows.

-- ===========================================================================
-- Hand-written. `migrate diff` emits a single
-- `ALTER TABLE "courses" ADD COLUMN "position" INTEGER NOT NULL`, which cannot
-- be applied to a table that already holds rows. Same three steps as the
-- resources migration.
-- ===========================================================================

ALTER TABLE "courses" ADD COLUMN "position" INTEGER;

-- Every existing course keeps the order its readers already know, which is the creation order the
-- lists have been applying to it. Partitioned by program, because a position is dense within one
-- program and means nothing across two.
UPDATE "courses" AS c
   SET "position" = numbered.position
  FROM (
    SELECT id,
           (row_number() OVER (PARTITION BY "program_id" ORDER BY "created_at") - 1) AS position
      FROM "courses"
  ) AS numbered
 WHERE c.id = numbered.id;

ALTER TABLE "courses" ALTER COLUMN "position" SET NOT NULL;
