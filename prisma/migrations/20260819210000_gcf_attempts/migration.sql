-- The General Coding Framework: CodeSignal results recorded against a person.
--
-- Purely additive. Two new tables and one new enum; nothing existing is renamed, dropped, or
-- backfilled, so this migration cannot lose data and needs no hand-written conversion. The body
-- below is `prisma migrate diff` output verbatim, with the privilege block appended.

-- CreateEnum
CREATE TYPE "GcfKind" AS ENUM ('PROCTORED', 'MOCK');

-- CreateTable
CREATE TABLE "gcf_attempts" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "kind" "GcfKind" NOT NULL,
    "score" INTEGER NOT NULL,
    "score_possible" INTEGER,
    "taken_on" DATE NOT NULL,
    "external_id" TEXT,
    "result_url" TEXT,
    "integrity_flagged" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gcf_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gcf_identities" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gcf_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gcf_attempts_student_id_taken_on_idx" ON "gcf_attempts"("student_id", "taken_on");

-- CreateIndex
CREATE UNIQUE INDEX "gcf_attempts_student_id_kind_taken_on_key" ON "gcf_attempts"("student_id", "kind", "taken_on");

-- CreateIndex
CREATE UNIQUE INDEX "gcf_identities_email_key" ON "gcf_identities"("email");

-- CreateIndex
CREATE INDEX "gcf_identities_student_id_idx" ON "gcf_identities"("student_id");

-- AddForeignKey
ALTER TABLE "gcf_attempts" ADD CONSTRAINT "gcf_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gcf_attempts" ADD CONSTRAINT "gcf_attempts_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gcf_identities" ADD CONSTRAINT "gcf_identities_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Deny all browser access to both tables, for the same reason as every other table here:
-- Supabase's default privileges grant every permission on tables in the `public` schema to
-- `anon` and `authenticated`, and neither of these is ever read directly by supabase-js. All
-- access goes through tRPC, which uses Prisma, which connects as the table owner and is
-- therefore not restricted by row level security.
--
-- Both matter more than most. `gcf_attempts` holds one fellow's assessment results, which are
-- the figures an employer eventually sees, and `gcf_identities` maps a personal email address to
-- a person — so a readable copy of either is a disclosure rather than an inconvenience.
REVOKE ALL ON TABLE public."gcf_attempts" FROM anon, authenticated;
ALTER TABLE public."gcf_attempts" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."gcf_identities" FROM anon, authenticated;
ALTER TABLE public."gcf_identities" ENABLE ROW LEVEL SECURITY;
