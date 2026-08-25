-- A Program above the Course.
--
-- Attendance is taken once a morning, and until now this schema took it once per course: a fellow
-- in three courses that all met on a Tuesday had three sessions to check into and three codes to
-- type. `Course` was the only cohort-shaped thing here, and once the layer above it exists the rest
-- of the duplication is visible too — one roster per course, one join link per course, and the
-- division of that roster between co-teaching instructors rebuilt inside each course as its own set
-- of groups.
--
-- So: `programs` owns its courses, one roster, one set of attendance days, its cohorts, and its
-- instructors. `course_groups` becomes `cohorts` and moves to the program, which is also where the
-- word is reclaimed — a cohort is now how a roster is divided among instructors, and never a term.
-- `group_memberships` goes entirely: a cohort is a partition, so `enrollments.cohort_id` says it.
--
-- **This is a clean break and it destroys data.** Every column added below is NOT NULL on a table
-- that holds rows, and there is no honest value to backfill: a course does not know which program it
-- belongs to, and merging several courses' identical rosters into one is a judgment nobody recorded.
-- So the coursework tables are emptied first, deliberately and in one statement. `profiles`,
-- `rubrics`, `instructor_invites`, `audit_events`, `gcf_attempts`, and `gcf_identities` are left
-- alone: identity, the four rubrics no router can author, the audit trail, and a fellow's GCF
-- history all outlive a matriculation.
--
-- Two consequences worth stating rather than discovering. Uploaded submissions stay in the private
-- storage bucket with nothing referencing them, because a bucket is not in this transaction; they
-- are unreachable rather than deleted. And every repository this application generated still exists
-- on GitHub under its old `cohort_slug` prefix, which is why `courses.slug` is globally unique
-- including archived rows — those names are still taken.

TRUNCATE TABLE
  public."team_memberships",
  public."teams",
  public."team_sets",
  public."group_memberships",
  public."course_groups",
  public."attendance_records",
  public."attendance_sessions",
  public."grading_draft_sections",
  public."grading_drafts",
  public."test_runs",
  public."submissions",
  public."assignments",
  public."resources",
  public."course_units",
  public."roster_entries",
  public."enrollments",
  public."course_instructors",
  public."courses"
  RESTART IDENTITY;

-- Drop the partial index before the column it reads.
--
-- `ALTER TABLE ... DROP COLUMN` would take this index with it silently, which is exactly the way a
-- hand-written artifact gets lost: `migrate diff` cannot see a partial index, so nothing downstream
-- would report it missing. Ownership moves to the program, so the replacement is created at the
-- bottom of this file on `program_instructors`.
DROP INDEX IF EXISTS "course_instructors_one_primary_per_course";

-- DropForeignKey
ALTER TABLE "attendance_records" DROP CONSTRAINT "attendance_records_enrollment_id_course_id_fkey";

-- DropForeignKey
ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_course_id_fkey";

-- DropForeignKey
ALTER TABLE "course_groups" DROP CONSTRAINT "course_groups_course_id_fkey";

-- DropForeignKey
ALTER TABLE "course_instructors" DROP CONSTRAINT "course_instructors_course_id_fkey";

-- DropForeignKey
ALTER TABLE "course_instructors" DROP CONSTRAINT "course_instructors_grading_group_id_fkey";

-- DropForeignKey
ALTER TABLE "course_instructors" DROP CONSTRAINT "course_instructors_user_id_fkey";

-- DropForeignKey
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_course_id_fkey";

-- DropForeignKey
ALTER TABLE "group_memberships" DROP CONSTRAINT "group_memberships_enrollment_id_fkey";

-- DropForeignKey
ALTER TABLE "group_memberships" DROP CONSTRAINT "group_memberships_group_id_fkey";

-- DropForeignKey
ALTER TABLE "roster_entries" DROP CONSTRAINT "roster_entries_course_id_fkey";

-- DropForeignKey
ALTER TABLE "team_memberships" DROP CONSTRAINT "team_memberships_enrollment_id_course_id_fkey";

-- DropForeignKey
ALTER TABLE "team_memberships" DROP CONSTRAINT "team_memberships_team_set_id_course_id_fkey";

-- DropForeignKey
ALTER TABLE "team_sets" DROP CONSTRAINT "team_sets_course_id_fkey";

-- DropIndex
DROP INDEX "attendance_records_course_id_status_idx";

-- DropIndex
DROP INDEX "attendance_sessions_course_id_date_idx";

-- DropIndex
DROP INDEX "attendance_sessions_course_id_date_key";

-- DropIndex
DROP INDEX "courses_co_teach_token_key";

-- DropIndex
DROP INDEX "courses_cohort_slug_key";

-- DropIndex
DROP INDEX "courses_join_token_key";

-- DropIndex
DROP INDEX "enrollments_course_id_student_id_key";

-- DropIndex
DROP INDEX "enrollments_id_course_id_key";

-- DropIndex
DROP INDEX "roster_entries_course_id_email_key";

-- DropIndex
DROP INDEX "roster_entries_course_id_github_username_key";

-- DropIndex
DROP INDEX "roster_entries_course_id_idx";

-- AlterTable
ALTER TABLE "attendance_records" DROP COLUMN "course_id",
ADD COLUMN     "program_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "attendance_sessions" DROP COLUMN "course_id",
ADD COLUMN     "program_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN     "program_id" UUID,
ADD COLUMN     "program_label" TEXT;

-- AlterTable
ALTER TABLE "course_instructors" DROP COLUMN "grading_group_id",
DROP COLUMN "is_primary",
ADD COLUMN     "program_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "courses" DROP COLUMN "attendance_late_after_minutes",
DROP COLUMN "co_teach_token",
DROP COLUMN "cohort_slug",
DROP COLUMN "cohort_term",
DROP COLUMN "join_token",
ADD COLUMN     "program_id" UUID NOT NULL,
ADD COLUMN     "published_at" TIMESTAMPTZ(6),
ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "enrollments" DROP COLUMN "course_id",
ADD COLUMN     "cohort_id" UUID,
ADD COLUMN     "program_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "roster_entries" DROP COLUMN "course_id",
ADD COLUMN     "program_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "team_memberships" DROP COLUMN "course_id",
ADD COLUMN     "program_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "team_sets" ADD COLUMN     "program_id" UUID NOT NULL;

-- DropTable
DROP TABLE "course_groups";

-- DropTable
DROP TABLE "group_memberships";

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "matriculation" TEXT NOT NULL,
    "join_token" TEXT NOT NULL,
    "instructor_token" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "attendance_late_after_minutes" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_instructors" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "cohort_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_instructors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohorts" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "programs_join_token_key" ON "programs"("join_token");

-- CreateIndex
CREATE UNIQUE INDEX "programs_instructor_token_key" ON "programs"("instructor_token");

-- CreateIndex
CREATE UNIQUE INDEX "programs_name_matriculation_key" ON "programs"("name", "matriculation");

-- CreateIndex
CREATE INDEX "program_instructors_cohort_id_idx" ON "program_instructors"("cohort_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_instructors_program_id_user_id_key" ON "program_instructors"("program_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cohorts_program_id_name_key" ON "cohorts"("program_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cohorts_id_program_id_key" ON "cohorts"("id", "program_id");

-- CreateIndex
CREATE INDEX "attendance_records_program_id_status_idx" ON "attendance_records"("program_id", "status");

-- CreateIndex
CREATE INDEX "attendance_sessions_program_id_date_idx" ON "attendance_sessions"("program_id", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_program_id_date_key" ON "attendance_sessions"("program_id", "date");

-- CreateIndex
CREATE INDEX "audit_events_program_id_occurred_at_idx" ON "audit_events"("program_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "course_instructors_program_id_user_id_idx" ON "course_instructors"("program_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");

-- CreateIndex
CREATE INDEX "courses_program_id_idx" ON "courses"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_id_program_id_key" ON "courses"("id", "program_id");

-- CreateIndex
CREATE INDEX "enrollments_cohort_id_idx" ON "enrollments"("cohort_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_program_id_student_id_key" ON "enrollments"("program_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_id_program_id_key" ON "enrollments"("id", "program_id");

-- CreateIndex
CREATE INDEX "roster_entries_program_id_idx" ON "roster_entries"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "roster_entries_program_id_github_username_key" ON "roster_entries"("program_id", "github_username");

-- CreateIndex
CREATE UNIQUE INDEX "roster_entries_program_id_email_key" ON "roster_entries"("program_id", "email");

-- CreateIndex
CREATE INDEX "team_sets_program_id_idx" ON "team_sets"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_sets_id_program_id_key" ON "team_sets"("id", "program_id");

-- AddForeignKey
ALTER TABLE "program_instructors" ADD CONSTRAINT "program_instructors_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_instructors" ADD CONSTRAINT "program_instructors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_instructors" ADD CONSTRAINT "program_instructors_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_instructors" ADD CONSTRAINT "course_instructors_course_id_program_id_fkey" FOREIGN KEY ("course_id", "program_id") REFERENCES "courses"("id", "program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_instructors" ADD CONSTRAINT "course_instructors_program_id_user_id_fkey" FOREIGN KEY ("program_id", "user_id") REFERENCES "program_instructors"("program_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_cohort_id_program_id_fkey" FOREIGN KEY ("cohort_id", "program_id") REFERENCES "cohorts"("id", "program_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_sets" ADD CONSTRAINT "team_sets_course_id_program_id_fkey" FOREIGN KEY ("course_id", "program_id") REFERENCES "courses"("id", "program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_set_id_program_id_fkey" FOREIGN KEY ("team_set_id", "program_id") REFERENCES "team_sets"("id", "program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_enrollment_id_program_id_fkey" FOREIGN KEY ("enrollment_id", "program_id") REFERENCES "enrollments"("id", "program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_enrollment_id_program_id_fkey" FOREIGN KEY ("enrollment_id", "program_id") REFERENCES "enrollments"("id", "program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one primary instructor per program.
--
-- `is_primary` marks whoever owns the matriculation: everybody who teaches can author and grade, and
-- the owner can additionally archive the program, delete it, decide who teaches which course, remove
-- another instructor, and replace either link. Two rows holding it on one program is two people who
-- can each archive it and neither of whom can be removed, failing quietly because every reader takes
-- the first row it finds. Transferring ownership is what would produce them, since it clears one row
-- and sets another.
--
-- This replaces `course_instructors_one_primary_per_course`, dropped at the top of this file.
-- Prisma cannot express a partial index, so it is hand-written and absent from schema.prisma.
-- `migrate diff` cannot see it either, so it survives rather than being proposed for removal by the
-- next schema change.
CREATE UNIQUE INDEX "program_instructors_one_primary_per_program"
  ON "program_instructors" ("program_id") WHERE "is_primary";

-- Deny all browser access to the three new tables, for the same reason as every other table here:
-- Supabase's default privileges grant every permission on tables in the `public` schema to `anon`
-- and `authenticated`, and none of these is ever read directly by supabase-js. All access goes
-- through tRPC, which uses Prisma, which connects as the table owner and is therefore not restricted
-- by row level security.
--
-- `programs` is the one to notice. It holds two tokens, and either one in the wrong hands is a
-- stranger on the roster or, worse, a stranger reading every fellow's grades in every course of the
-- matriculation. Neither is ever selected into a payload; this is what leaves no second route to the
-- rows.
REVOKE ALL ON TABLE public."programs" FROM anon, authenticated;
ALTER TABLE public."programs" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."program_instructors" FROM anon, authenticated;
ALTER TABLE public."program_instructors" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."cohorts" FROM anon, authenticated;
ALTER TABLE public."cohorts" ENABLE ROW LEVEL SECURITY;
