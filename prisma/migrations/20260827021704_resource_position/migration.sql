-- Resources are ordered by hand within their module.
--
-- The alphabet cannot know that a lecture recording belongs above the reading that follows it,
-- and renaming a resource until the sort put it in the right place was the only lever an
-- instructor had. `position` is the same column `course_units` already carries, for the same
-- reason and with the same rules: dense from zero within its parent, assigned by the server,
-- and deliberately not unique, because `reorder` rewrites a whole sequence in one statement and
-- a unique constraint would refuse the intermediate states that statement passes through.

-- DropIndex
--
-- Replaced rather than joined by a second one. Every read of a module's resources now wants the
-- order too, and an index on `course_unit_id` alone is a prefix of the pair below.
DROP INDEX "resources_course_unit_id_idx";

-- ===========================================================================
-- Hand-written from here down. `migrate diff` emits a single
-- `ADD COLUMN "position" INTEGER NOT NULL`, which cannot be applied to a table
-- that already holds rows. Same three steps as the modules migration.
-- ===========================================================================

ALTER TABLE "resources" ADD COLUMN "position" INTEGER;

-- Every existing resource keeps the order its readers already know, which is the alphabet the
-- server has been applying to it. Partitioned by module, because a position is dense within one
-- module and means nothing across two.
UPDATE "resources" AS r
   SET "position" = numbered.position
  FROM (
    SELECT id,
           (row_number() OVER (PARTITION BY "course_unit_id" ORDER BY "title") - 1) AS position
      FROM "resources"
  ) AS numbered
 WHERE r.id = numbered.id;

ALTER TABLE "resources" ALTER COLUMN "position" SET NOT NULL;

-- CreateIndex
CREATE INDEX "resources_course_unit_id_position_idx" ON "resources"("course_unit_id", "position");
