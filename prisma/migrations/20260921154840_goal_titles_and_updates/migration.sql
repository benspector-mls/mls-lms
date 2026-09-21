-- A goal gets a title the fellow writes, and the competency it was built on becomes one field of
-- it rather than its name — a goal may now have none. Beneath each goal, updates: progress notes
-- in markdown with files attached as evidence, stored in the same private bucket as submission
-- uploads under the update's id. Instructors read all of it and write none of it.

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "title" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "entry_id" DROP NOT NULL,
ALTER COLUMN "entry_kind" DROP NOT NULL,
ALTER COLUMN "entry_text" DROP NOT NULL,
ALTER COLUMN "competency_name" DROP NOT NULL;

-- CreateTable
CREATE TABLE "goal_updates" (
    "id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_update_attachments" (
    "id" UUID NOT NULL,
    "update_id" UUID NOT NULL,
    "upload_path" TEXT NOT NULL,
    "upload_filename" TEXT NOT NULL,
    "upload_size_bytes" INTEGER NOT NULL,
    "upload_content_type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_update_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_updates_goal_id_created_at_idx" ON "goal_updates"("goal_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "goal_update_attachments_update_id_idx" ON "goal_update_attachments"("update_id");

-- AddForeignKey
ALTER TABLE "goal_updates" ADD CONSTRAINT "goal_updates_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_update_attachments" ADD CONSTRAINT "goal_update_attachments_update_id_fkey" FOREIGN KEY ("update_id") REFERENCES "goal_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written from here down. `migrate diff` cannot see any of it, so it survives rather than
-- being proposed for removal on the next migration.

-- Every goal so far was titled on screen by the wording of the entry it was built on. Make that
-- literal, so no goal reads as untitled the morning this lands. The column's default stays: it is
-- what lets a release that does not know the column keep creating goals during a deploy and
-- after a rollback, and the zod input is what requires words from this release.
UPDATE "goals" SET "title" = "entry_text" WHERE "title" = '' AND "entry_text" IS NOT NULL;

-- The competency columns are written together or not at all. A goal with no competency is a goal
-- the fellow chose to write without one; a goal with half of one is a bug, and this is what
-- refuses it from outside the application's own code.
ALTER TABLE public."goals"
  ADD CONSTRAINT goals_competency_all_or_none
  CHECK (
    ("entry_id" IS NULL) = ("entry_kind" IS NULL)
    AND ("entry_id" IS NULL) = ("entry_text" IS NULL)
    AND ("entry_id" IS NULL) = ("competency_name" IS NULL)
  );

-- The same cap the zod input puts on an update, held by the database as well, because a script
-- does not run the application's code. Empty is allowed: an update can be a screenshot alone.
ALTER TABLE public."goal_updates"
  ADD CONSTRAINT goal_updates_body_length
  CHECK (char_length("body") <= 20000);

-- Reached only through the application's own connection, like every other table here. What is on
-- these two is a fellow's own writing and the names of files they attached, readable by them and
-- by the instructors of their program through procedures that check exactly that.
REVOKE ALL ON TABLE public."goal_updates" FROM anon, authenticated;
ALTER TABLE public."goal_updates" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."goal_update_attachments" FROM anon, authenticated;
ALTER TABLE public."goal_update_attachments" ENABLE ROW LEVEL SECURITY;
