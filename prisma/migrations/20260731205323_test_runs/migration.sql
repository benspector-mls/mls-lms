-- CreateEnum
CREATE TYPE "TestRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'TIMED_OUT', 'ERRORED');

-- CreateEnum
CREATE TYPE "TestRunTrigger" AS ENUM ('MANUAL', 'WEBHOOK');

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "runner_config" JSONB,
ADD COLUMN     "runner_preset" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "template_ref" TEXT;

-- CreateTable
CREATE TABLE "test_runs" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "head_sha" TEXT NOT NULL,
    "trigger" "TestRunTrigger" NOT NULL DEFAULT 'MANUAL',
    "status" "TestRunStatus" NOT NULL DEFAULT 'RUNNING',
    "runner_preset" TEXT NOT NULL,
    "e2b_template" TEXT NOT NULL,
    "sandbox_id" TEXT,
    "template_commit_sha" TEXT,
    "setup_exit_code" INTEGER,
    "test_exit_code" INTEGER,
    "tests_total" INTEGER,
    "tests_passed" INTEGER,
    "tests_failed" INTEGER,
    "tests_skipped" INTEGER,
    "pass_rate" DOUBLE PRECISION,
    "results" JSONB NOT NULL DEFAULT '[]',
    "tampered_paths" JSONB NOT NULL DEFAULT '[]',
    "stdout_tail" TEXT,
    "stderr_tail" TEXT,
    "error_detail" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "setup_duration_ms" INTEGER,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_runs_submission_id_head_sha_idx" ON "test_runs"("submission_id", "head_sha");

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Supabase integration (hand-written; not generated from schema.prisma)
-- ---------------------------------------------------------------------------

-- Deny all browser access to test_runs, for the same reason as every other
-- table in 20260731135802_courses_assignments_submissions: Supabase's default
-- privileges grant every permission on new tables in the `public` schema to the
-- `anon` and `authenticated` roles, and this table is never read directly by
-- supabase-js. All access goes through tRPC, which uses Prisma, which connects
-- as the table owner and is therefore not restricted by row level security.
--
-- REVOKE removes the table privileges; enabling row level security with zero
-- policies denies access by default even if a privilege is granted later.
REVOKE ALL ON TABLE public."test_runs" FROM anon, authenticated;
ALTER TABLE public."test_runs" ENABLE ROW LEVEL SECURITY;
