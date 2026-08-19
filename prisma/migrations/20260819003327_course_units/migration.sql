-- Modules, projects, and assessments become one table: the course unit.
--
-- **Hand-written, and deliberately not what `migrate diff` produced.** That output drops
-- `modules`, drops `assignments.module_id`, and adds `course_unit_id NOT NULL` to tables that
-- already hold rows — which fails outright on the NOT NULL, and would delete every module in
-- every course if it did not. What follows renames rather than recreates, so no row moves and
-- no id changes. `migrate diff` is still the check: replayed after this file, it must report no
-- difference at all.
--
-- A project used to be a `cumulative_checkpoints` row living *inside* a module, which gave an
-- assignment two possible parents and needed a rule deriving one from the other. Now it is a
-- unit like any other and an assignment names it directly.

-- CreateEnum
CREATE TYPE "CourseUnitCategory" AS ENUM ('MODULE', 'PROJECT', 'ASSESSMENT');

-- ---------------------------------------------------------------------------------------
-- `modules` becomes `course_units`, keeping every row.
--
-- The constraints and indexes are renamed with it. Postgres does not rename them along with
-- the table, and Prisma derives their expected names from the table's — so leaving them would
-- make every future `migrate diff` report a difference that is only a name.
-- ---------------------------------------------------------------------------------------
ALTER TABLE "modules" RENAME TO "course_units";
ALTER TABLE "course_units" RENAME CONSTRAINT "modules_pkey" TO "course_units_pkey";
ALTER TABLE "course_units" RENAME CONSTRAINT "modules_course_id_fkey" TO "course_units_course_id_fkey";
ALTER INDEX "modules_course_id_position_idx" RENAME TO "course_units_course_id_position_idx";
ALTER INDEX "modules_course_id_name_key" RENAME TO "course_units_course_id_name_key";

-- AlterTable
--
-- Every existing row is a module, which is exactly what the default says. `overview` is new on
-- all three categories: a project's brief lives there, and a module with an introduction is a
-- real thing.
ALTER TABLE "course_units"
  ADD COLUMN "category" "CourseUnitCategory" NOT NULL DEFAULT 'MODULE',
  ADD COLUMN "overview" TEXT;

-- ---------------------------------------------------------------------------------------
-- The two tables that point at a unit follow the rename.
--
-- A rename rather than add-backfill-drop, because the column already holds exactly the right
-- values: every assignment and every resource already belongs to what is now a course unit.
-- ---------------------------------------------------------------------------------------
ALTER TABLE "assignments" RENAME COLUMN "module_id" TO "course_unit_id";
ALTER TABLE "assignments" RENAME CONSTRAINT "assignments_module_id_fkey" TO "assignments_course_unit_id_fkey";

ALTER TABLE "resources" RENAME COLUMN "module_id" TO "course_unit_id";
ALTER TABLE "resources" RENAME CONSTRAINT "resources_module_id_fkey" TO "resources_course_unit_id_fkey";
ALTER INDEX "resources_module_id_idx" RENAME TO "resources_course_unit_id_idx";

-- ---------------------------------------------------------------------------------------
-- Every checkpoint becomes a course unit, in the place it used to sit.
--
-- **Position is the whole of the care here.** All three categories now share one sequence, so a
-- converted project has to land immediately after the module it lived in — appending them at
-- the end of the course instead would silently reorder every instructor's term. Doubling the
-- existing positions opens a gap after each one to drop a project into, and the renumber at the
-- end closes the gaps back up.
-- ---------------------------------------------------------------------------------------
UPDATE "course_units" SET "position" = "position" * 2;

/*
  The checkpoint's own id becomes the unit's id, which is what makes repointing the assignments
  below a copy of one column rather than a join through a mapping table.

  The name is suffixed only when it would collide. `@@unique([courseId, name])` used to be per
  course for modules and per *module* for checkpoints, so a course could legitimately hold a
  module and a project of the same name; course-wide now, that pair has to be told apart.
*/
INSERT INTO "course_units" ("id", "course_id", "category", "name", "position", "overview", "created_at", "updated_at")
SELECT
    c."id",
    c."course_id",
    c."category"::text::"CourseUnitCategory",
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "course_units" u
         WHERE u."course_id" = c."course_id" AND u."name" = c."title"
      )
      THEN c."title" || ' (' || lower(c."category"::text) || ')'
      ELSE c."title"
    END,
    parent."position" + 1,
    c."overview",
    c."created_at",
    c."updated_at"
  FROM "cumulative_checkpoints" c
  JOIN "course_units" parent ON parent."id" = c."module_id";

-- Each part leaves the module it was filed under and belongs to its project directly. This is
-- the change that gives an assignment one parent again.
UPDATE "assignments"
   SET "course_unit_id" = "cumulative_checkpoint_id"
 WHERE "cumulative_checkpoint_id" IS NOT NULL;

-- Close the gaps the doubling opened, so a course's units read 0, 1, 2, … again. Ordered by the
-- spread positions, so the sequence this produces is the one the course already had with the
-- projects inserted where they belong.
WITH ordered AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "course_id" ORDER BY "position", "name") - 1 AS pos
    FROM "course_units"
)
UPDATE "course_units" u
   SET "position" = ordered.pos
  FROM ordered
 WHERE u."id" = ordered."id";

-- ---------------------------------------------------------------------------------------
-- The checkpoint apparatus goes.
--
-- Dropping the column takes its foreign key and its index with it, which is why neither is
-- named here.
-- ---------------------------------------------------------------------------------------
ALTER TABLE "assignments" DROP COLUMN "cumulative_checkpoint_id";

-- DropTable
DROP TABLE "cumulative_checkpoints";

-- DropEnum
DROP TYPE "CumulativeCheckpointCategory";

-- CreateIndex
--
-- New rather than renamed: `assignments.module_id` never carried one. Every screen that draws a
-- unit reads its assignments through this.
CREATE INDEX "assignments_course_unit_id_idx" ON "assignments"("course_unit_id");

-- Deny all browser access to the renamed table, for the same reason as every other table:
-- Supabase's default privileges grant every permission on tables in the `public` schema to
-- `anon` and `authenticated`, and this table is never read directly by supabase-js. All access
-- goes through tRPC, which uses Prisma, which connects as the table owner and is therefore not
-- restricted by row level security.
--
-- A rename carries the old table's privileges and its row-level-security setting across, so
-- these restate what `modules` already had rather than granting anything new. They are here so
-- that the block travels with the table under the name a reader will search for.
REVOKE ALL ON TABLE public."course_units" FROM anon, authenticated;
ALTER TABLE public."course_units" ENABLE ROW LEVEL SECURITY;
