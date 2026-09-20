-- Goals become the fellow's own: no session to hang off, no release to wait for, and no author
-- column because the enrollment already says whose they are. Nothing on the table is
-- instructor-writable any more; an instructor who disagrees with a fellow's assessment says so in
-- the coaching session.

-- DropForeignKey
ALTER TABLE "goals" DROP CONSTRAINT "goals_author_id_fkey";

-- DropForeignKey
ALTER TABLE "goals" DROP CONSTRAINT "goals_session_id_fkey";

-- DropIndex
DROP INDEX "goals_enrollment_id_released_at_idx";

-- DropIndex
DROP INDEX "goals_session_id_idx";

-- AlterTable
ALTER TABLE "goals" DROP COLUMN "author_id",
DROP COLUMN "released_at",
DROP COLUMN "session_id";

-- CreateIndex
CREATE INDEX "goals_enrollment_id_created_at_idx" ON "goals"("enrollment_id", "created_at" DESC);

