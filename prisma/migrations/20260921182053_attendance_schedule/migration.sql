-- A program can declare when it meets: a first day, a last day, the weekdays in between, and what
-- time class starts. Saving that makes one attendance session per meeting day from today onward,
-- each carrying its own clock, so a morning opens itself and a fellow who arrives early is on
-- time. Instructors remove the days the program will not meet.
--
-- Every column is nullable or defaulted, and no existing row changes. A program without a schedule
-- behaves exactly as it did.

-- ---------------------------------------------------------------------------
-- The audit values
-- ---------------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROGRAM_ATTENDANCE_SCHEDULE_SET';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_SESSIONS_REMOVED';

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------

ALTER TABLE public."programs"
  ADD COLUMN "attendance_starts_on" DATE,
  ADD COLUMN "attendance_ends_on" DATE,
  ADD COLUMN "attendance_weekdays" INTEGER[],
  ADD COLUMN "attendance_starts_at" TEXT;

-- ---------------------------------------------------------------------------
-- The invariants that keep a schedule one fact rather than four
-- ---------------------------------------------------------------------------

-- All four together or none of them. A program holding a start date and no start time is not a
-- state this design has a name for: there would be days to make and no clock to give them.
--
-- The weekday array carries the same fact through its length. `coalesce` because Prisma renders a
-- scalar list as a nullable array column, so "no schedule" arrives here as NULL on every row that
-- existed before this migration and as '{}' on every row written after it. Both mean the same
-- thing and this CHECK has to accept both, or the first UPDATE against an old row would fail.
ALTER TABLE public."programs"
  ADD CONSTRAINT "programs_schedule_is_whole" CHECK (
    ("attendance_starts_on" IS NULL) = ("attendance_ends_on" IS NULL)
    AND ("attendance_starts_on" IS NULL) = ("attendance_starts_at" IS NULL)
    AND ("attendance_starts_on" IS NULL) = (coalesce(cardinality("attendance_weekdays"), 0) = 0)
  );

-- A program cannot finish before it begins. Equal is allowed: a one-day program is a real thing.
ALTER TABLE public."programs"
  ADD CONSTRAINT "programs_schedule_is_forward" CHECK (
    "attendance_ends_on" IS NULL OR "attendance_ends_on" >= "attendance_starts_on"
  );

-- "09:30" and nothing else, matching `SchoolClock` in lib/school-time.ts. Asserted here as well as
-- in the procedure's schema because `instantAtSchoolClock` parses this string directly: a value
-- this column accepted but that parser did not would produce an Invalid Date as a session's start,
-- and a session with an unreadable clock is one nobody can check into or correct.
ALTER TABLE public."programs"
  ADD CONSTRAINT "programs_schedule_clock" CHECK (
    "attendance_starts_at" IS NULL
    OR "attendance_starts_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  );

-- Sunday 0 through Saturday 6. A 7 in this array would be a weekday no day ever falls on, so the
-- program would quietly meet less often than its settings screen claims.
ALTER TABLE public."programs"
  ADD CONSTRAINT "programs_schedule_weekdays" CHECK (
    "attendance_weekdays" IS NULL OR "attendance_weekdays" <@ ARRAY[0,1,2,3,4,5,6]
  );
