-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('SELF_CHECK_IN', 'INSTRUCTOR', 'FINALIZED');

-- AlterEnum
--
-- `ALTER TYPE ... ADD VALUE` runs inside the transaction Prisma wraps this file in, which Postgres
-- permits as long as the new values are not *used* in the same transaction. Nothing below writes a
-- row, so this is safe — the same note as 20260814112039. The generated warning about adding more
-- than one value at a time applies to Postgres 11 and earlier; Supabase is well past that.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_SESSION_STARTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_SESSION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_SESSION_REOPENED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_SESSION_ENDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_SESSION_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_CODE_ROTATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_CHECKED_IN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_STATUS_SET';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_CHECK_IN_FAILED';

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "attendance_late_after_minutes" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "started_by_id" UUID,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "late_after_minutes" INTEGER NOT NULL,
    "code_secret" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "source" "AttendanceSource" NOT NULL,
    "checked_in_at" TIMESTAMPTZ(6),
    "recorded_by_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_sessions_course_id_date_idx" ON "attendance_sessions"("course_id", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_course_id_date_key" ON "attendance_sessions"("course_id", "date");

-- CreateIndex
CREATE INDEX "attendance_records_enrollment_id_idx" ON "attendance_records"("enrollment_id");

-- CreateIndex
CREATE INDEX "attendance_records_course_id_status_idx" ON "attendance_records"("course_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_session_id_enrollment_id_key" ON "attendance_records"("session_id", "enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_id_course_id_key" ON "enrollments"("id", "course_id");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_enrollment_id_course_id_fkey" FOREIGN KEY ("enrollment_id", "course_id") REFERENCES "enrollments"("id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Supabase integration (hand-written; not generated from schema.prisma)
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public."attendance_sessions" FROM anon, authenticated;
ALTER TABLE public."attendance_sessions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."attendance_records" FROM anon, authenticated;
ALTER TABLE public."attendance_records" ENABLE ROW LEVEL SECURITY;

-- This block matters more here than on most tables. `code_secret` is the whole of the credential a
-- fellow types, and `authenticated` is the role every signed-in browser holds through the Supabase
-- client. Prisma bypasses row level security because it connects as the owner, so what this
-- protects is precisely the client a student's browser already has in its hands.

-- ---------------------------------------------------------------------------
-- The invariants the Prisma schema cannot state
-- ---------------------------------------------------------------------------

-- A session that ends before it starts accepts nothing and reads on the screen as a morning
-- nobody took. Cheaper to make it unrepresentable than to explain it.
ALTER TABLE public."attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_window_is_forward"
  CHECK ("ends_at" > "started_at");

-- Zero is meaningful — a course where arriving after the bell is late — so the floor is zero
-- rather than one. The ceiling is a day, past which the column is being used to mean something
-- other than "the first few minutes".
ALTER TABLE public."attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_late_threshold_is_sane"
  CHECK ("late_after_minutes" >= 0 AND "late_after_minutes" <= 1440);

-- 256 bits of hex. A short secret would still derive a four-digit code, so nothing downstream
-- would fail and nobody would notice — which is exactly why the length is asserted here rather
-- than trusted to the one function that generates it.
ALTER TABLE public."attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_secret_is_full_length"
  CHECK (char_length("code_secret") = 64);

-- **A self check-in has a time.** This is what makes lateness recomputable when an instructor
-- corrects a session they started early: a row claiming a fellow checked themselves in, with no
-- record of when, cannot be re-decided and would have to be left wrong.
ALTER TABLE public."attendance_records"
  ADD CONSTRAINT "attendance_records_self_check_in_has_a_time"
  CHECK ("source" <> 'SELF_CHECK_IN' OR "checked_in_at" IS NOT NULL);

-- Nobody recorded a self check-in but the fellow. A `recorded_by_id` on one would name an
-- instructor as having made a decision they never made.
ALTER TABLE public."attendance_records"
  ADD CONSTRAINT "attendance_records_self_check_in_has_no_recorder"
  CHECK ("source" <> 'SELF_CHECK_IN' OR "recorded_by_id" IS NULL);

-- A finalized row is written when a session ends, for the fellows nobody recorded. It therefore
-- has no arrival time, and it can only ever say one thing.
ALTER TABLE public."attendance_records"
  ADD CONSTRAINT "attendance_records_finalized_has_no_time"
  CHECK ("source" <> 'FINALIZED' OR "checked_in_at" IS NULL);

-- **A finalized row is ABSENT and nothing else**, and this is the one rule in the table worth
-- stating in Postgres rather than in a procedure. A FINALIZED row saying PRESENT would be the
-- application asserting that somebody attended on the strength of no evidence at all — no code
-- typed, no instructor's decision, nothing. That is the single claim this table must never be
-- able to make, because it is the claim a stipend is paid against.
ALTER TABLE public."attendance_records"
  ADD CONSTRAINT "attendance_records_finalized_means_absent"
  CHECK ("source" <> 'FINALIZED' OR "status" = 'ABSENT');
