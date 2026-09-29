-- A resource may carry a check for understanding: one question about that reading, note, or video,
-- which each fellow answers up to three times with a wait between attempts, every attempt reviewed
-- into a level on the SOLO taxonomy. Two tables — the question, and the attempts at it — and no
-- change to any existing column, so the previous release runs unchanged against this schema: it
-- never names either table.

-- CreateEnum
CREATE TYPE "CheckLevel" AS ENUM ('BLOCKED', 'UNISTRUCTURAL', 'MULTISTRUCTURAL', 'RELATIONAL', 'EXTENDED_ABSTRACT');

-- CreateTable
CREATE TABLE "checks_for_understanding" (
    "id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "objective" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "facts_example" TEXT NOT NULL,
    "exemplar" TEXT NOT NULL,
    "retry_wait_hours" INTEGER NOT NULL DEFAULT 168,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checks_for_understanding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_attempts" (
    "id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "answer" TEXT NOT NULL,
    "wants_help" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "CheckLevel",
    "explanation" TEXT,
    "review_error" TEXT,
    "model_metadata" JSONB,
    "instructor_level" "CheckLevel",
    "instructor_level_by_id" UUID,
    "instructor_level_at" TIMESTAMPTZ(6),

    CONSTRAINT "check_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checks_for_understanding_resource_id_key" ON "checks_for_understanding"("resource_id");

-- CreateIndex
CREATE INDEX "check_attempts_student_id_idx" ON "check_attempts"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "check_attempts_check_id_student_id_attempt_key" ON "check_attempts"("check_id", "student_id", "attempt");

-- AddForeignKey
ALTER TABLE "checks_for_understanding" ADD CONSTRAINT "checks_for_understanding_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_attempts" ADD CONSTRAINT "check_attempts_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "checks_for_understanding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_attempts" ADD CONSTRAINT "check_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written from here down. `migrate diff` cannot see any of it.

-- Both tables are reached only through the application's own connection; Supabase's client roles
-- have no business here, same as every other table.
REVOKE ALL ON TABLE public."checks_for_understanding" FROM anon, authenticated;
ALTER TABLE public."checks_for_understanding" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."check_attempts" FROM anon, authenticated;
ALTER TABLE public."check_attempts" ENABLE ROW LEVEL SECURITY;
