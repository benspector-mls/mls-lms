-- A fellow collects the topics they want to raise at their next coaching session, one row each,
-- and removes them once talked about. Under each goal, a conversation both sides write: a coach
-- asking for a timeframe, the fellow answering. The goal's own columns stay the fellow's; the
-- new receipt column on it is what the fellow's sidebar count is computed against.

-- CreateEnum
CREATE TYPE "GoalCommentAuthor" AS ENUM ('STUDENT', 'INSTRUCTOR');

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "comments_read_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "coaching_topics" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coaching_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_comments" (
    "id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "author_id" UUID,
    "author_role" "GoalCommentAuthor" NOT NULL,
    "body" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coaching_topics_enrollment_id_created_at_idx" ON "coaching_topics"("enrollment_id", "created_at");

-- CreateIndex
CREATE INDEX "goal_comments_goal_id_created_at_idx" ON "goal_comments"("goal_id", "created_at");

-- AddForeignKey
ALTER TABLE "coaching_topics" ADD CONSTRAINT "coaching_topics_enrollment_id_program_id_fkey" FOREIGN KEY ("enrollment_id", "program_id") REFERENCES "enrollments"("id", "program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_comments" ADD CONSTRAINT "goal_comments_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_comments" ADD CONSTRAINT "goal_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written from here down. `migrate diff` cannot see any of it, so it survives rather than
-- being proposed for removal on the next migration.

-- The same caps the zod inputs put on a topic and on a comment, held by the database as well,
-- because a script does not run the application's code. A topic needs words; a comment does too.
ALTER TABLE public."coaching_topics"
  ADD CONSTRAINT coaching_topics_body_length
  CHECK (char_length("body") BETWEEN 1 AND 2000);

ALTER TABLE public."goal_comments"
  ADD CONSTRAINT goal_comments_body_length
  CHECK (char_length("body") BETWEEN 1 AND 5000);

-- Reached only through the application's own connection, like every other table here. A topic is
-- a fellow's own writing, read by them and by the instructors of their program; a comment is one
-- side's message to the other under a goal, read by both through procedures that check exactly
-- that.
REVOKE ALL ON TABLE public."coaching_topics" FROM anon, authenticated;
ALTER TABLE public."coaching_topics" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."goal_comments" FROM anon, authenticated;
ALTER TABLE public."goal_comments" ENABLE ROW LEVEL SECURITY;
