-- A project or an assessment: several assignments graded as one piece of work.
--
-- Nothing here backfills and nothing here changes an existing row. Every assignment that
-- exists keeps `cumulative_checkpoint_id` NULL, which is exactly what "an ordinary
-- assignment" means in this design — so the column is added in its final state and the
-- three-way split of assignments, assessments, and projects is correct the moment the
-- migration finishes.

-- CreateEnum
--
-- Two values rather than three. An ordinary assignment is not a checkpoint at all, it is an
-- assignment whose `cumulative_checkpoint_id` is NULL, so a third value here would create
-- rows that say what a null column already says.
CREATE TYPE "CumulativeCheckpointCategory" AS ENUM ('ASSESSMENT', 'PROJECT');

-- CreateTable
--
-- No score, no submission, no due date, and no publish state, all deliberately. Whether a
-- student has completed a project is read from `is_complete` on its deliverables'
-- submissions; its due date is the latest of its parts'; it becomes visible to a student
-- when one of its parts is published. Each of those columns would be a second answer to a
-- question the parts have already answered.
CREATE TABLE "cumulative_checkpoints" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "category" "CumulativeCheckpointCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "overview" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cumulative_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cumulative_checkpoints_module_id_idx" ON "cumulative_checkpoints"("module_id");

-- CreateIndex
--
-- One "Mod 4 Project" per module, for the reason a module's name is unique in its course:
-- two with the same title are indistinguishable in every list and every select.
CREATE UNIQUE INDEX "cumulative_checkpoints_module_id_title_key" ON "cumulative_checkpoints"("module_id", "title");

-- AlterTable
--
-- Nullable, and it stays nullable. Most work in the program is an ordinary assignment, and
-- every row written before today is one.
ALTER TABLE "assignments" ADD COLUMN     "cumulative_checkpoint_id" UUID;

-- CreateIndex
CREATE INDEX "assignments_cumulative_checkpoint_id_idx" ON "assignments"("cumulative_checkpoint_id");

-- AddForeignKey
ALTER TABLE "cumulative_checkpoints" ADD CONSTRAINT "cumulative_checkpoints_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- RESTRICT, matching the constraint assignments already have on their module and for the
-- same reason: removing a module must never take the projects in it, and the graded
-- deliverables beneath those, with it.
ALTER TABLE "cumulative_checkpoints" ADD CONSTRAINT "cumulative_checkpoints_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
--
-- RESTRICT again, and this is the one that matters most. A deliverable carries submissions,
-- approved grades, and the feedback a student has already been given. Removing a project
-- must refuse while it still holds any of that rather than cascade through it.
-- `cumulativeCheckpoints.remove` refuses for the same reason; this is the database saying
-- it too rather than trusting that it was asked.
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_cumulative_checkpoint_id_fkey" FOREIGN KEY ("cumulative_checkpoint_id") REFERENCES "cumulative_checkpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deny all browser access to the new table, for the same reason as every other table:
-- Supabase's default privileges grant every permission on new tables in the `public`
-- schema to `anon` and `authenticated`, and this table is never read directly by
-- supabase-js. All access goes through tRPC, which uses Prisma, which connects as the
-- table owner and is therefore not restricted by row level security.
--
-- REVOKE removes the table privileges; enabling row level security with zero policies
-- denies access by default even if a privilege is granted later.
REVOKE ALL ON TABLE public."cumulative_checkpoints" FROM anon, authenticated;
ALTER TABLE public."cumulative_checkpoints" ENABLE ROW LEVEL SECURITY;
