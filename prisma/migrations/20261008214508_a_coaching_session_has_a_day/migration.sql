-- A coaching session is dated by the day it is held, which the instructor sets on the form: a coach
-- who opens a session early to prepare is writing about a conversation on a later day, and the
-- lists on both sides should say so.

-- DropIndex
DROP INDEX "coaching_sessions_enrollment_id_created_at_idx";

-- AlterTable
ALTER TABLE "coaching_sessions" ADD COLUMN     "held_on" DATE NOT NULL DEFAULT CURRENT_DATE;

-- CreateIndex
CREATE INDEX "coaching_sessions_enrollment_id_held_on_created_at_idx" ON "coaching_sessions"("enrollment_id", "held_on" DESC, "created_at" DESC);

-- Hand-written from here down.

-- Every session so far was dated on screen by when it was completed, or started if it never was.
-- Make that literal, in the school's own timezone, so no session changes its date the morning this
-- lands. The column's default stays for the previous release, which never writes it.
UPDATE "coaching_sessions"
SET "held_on" = (COALESCE("ended_at", "created_at") AT TIME ZONE 'America/New_York')::date;
