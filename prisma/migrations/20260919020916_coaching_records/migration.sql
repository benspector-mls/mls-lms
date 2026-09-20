-- CreateEnum
CREATE TYPE "DevelopmentMarker" AS ENUM ('FOUNDATIONAL', 'DEVELOPING', 'PROFICIENT', 'EXCEEDS');

-- CreateEnum
CREATE TYPE "CompetencyEntryKind" AS ENUM ('INDICATOR', 'PITFALL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'COACHING_NOTE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'COACHING_NOTE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'COACHING_NOTE_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'COACHING_SESSION_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'COACHING_SESSION_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'GOAL_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'GOAL_DELETED';

-- CreateTable
CREATE TABLE "instructor_notes" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instructor_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coaching_sessions" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "temperature" INTEGER,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "ended_at" TIMESTAMPTZ(6),
    "snapshot" JSONB,
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coaching_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "session_id" UUID,
    "entry_id" TEXT NOT NULL,
    "entry_kind" "CompetencyEntryKind" NOT NULL,
    "entry_text" TEXT NOT NULL,
    "competency_name" TEXT NOT NULL,
    "success_criteria" TEXT NOT NULL,
    "objectives" TEXT NOT NULL,
    "action_plan" TEXT NOT NULL,
    "marker" "DevelopmentMarker",
    "released_at" TIMESTAMPTZ(6),
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instructor_notes_enrollment_id_created_at_idx" ON "instructor_notes"("enrollment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "coaching_sessions_enrollment_id_created_at_idx" ON "coaching_sessions"("enrollment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "goals_enrollment_id_released_at_idx" ON "goals"("enrollment_id", "released_at");

-- CreateIndex
CREATE INDEX "goals_session_id_idx" ON "goals"("session_id");

-- AddForeignKey
ALTER TABLE "instructor_notes" ADD CONSTRAINT "instructor_notes_enrollment_id_program_id_fkey" FOREIGN KEY ("enrollment_id", "program_id") REFERENCES "enrollments"("id", "program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_notes" ADD CONSTRAINT "instructor_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_enrollment_id_program_id_fkey" FOREIGN KEY ("enrollment_id", "program_id") REFERENCES "enrollments"("id", "program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_enrollment_id_program_id_fkey" FOREIGN KEY ("enrollment_id", "program_id") REFERENCES "enrollments"("id", "program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "coaching_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written from here down. `migrate diff` cannot see any of it, so it survives rather than
-- being proposed for removal on the next migration.

-- These tables are reached only through the application's own connection; Supabase's client
-- roles have no business here, same as every other table. It matters more than usual for these
-- three: notes and answers are staff-only writing about a person, and a readable copy is a
-- disclosure rather than an inconvenience.
REVOKE ALL ON TABLE public."instructor_notes" FROM anon, authenticated;
ALTER TABLE public."instructor_notes" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."coaching_sessions" FROM anon, authenticated;
ALTER TABLE public."coaching_sessions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."goals" FROM anon, authenticated;
ALTER TABLE public."goals" ENABLE ROW LEVEL SECURITY;

-- The temperature is a 1-to-10 scale and nothing else. The zod schema says the same thing; the
-- constraint is what makes a bypassed procedure unable to disagree.
ALTER TABLE public."coaching_sessions"
  ADD CONSTRAINT coaching_sessions_temperature_range
  CHECK (temperature IS NULL OR temperature BETWEEN 1 AND 10);

-- A completed session is exactly a session carrying its snapshot: completeSession writes the two
-- together, and the pair is the whole of what the fellow's page renders.
ALTER TABLE public."coaching_sessions"
  ADD CONSTRAINT coaching_sessions_ended_has_snapshot
  CHECK ((ended_at IS NULL) = (snapshot IS NULL));
