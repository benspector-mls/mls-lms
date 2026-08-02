-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('INVITED', 'ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "RubricScaleType" AS ENUM ('POINTS', 'CHECKLIST', 'SHORT_RESPONSE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('NOT_STARTED', 'ACCEPTED', 'SUBMITTED', 'DRAFT_READY', 'GRADED', 'GRADING_FAILED', 'NEEDS_MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "SalesforceSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "GradingDraftStatus" AS ENUM ('GENERATING', 'READY', 'NEEDS_MANUAL_REVIEW', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'LOW');

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "github_user_id" BIGINT;

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cohort_term" TEXT NOT NULL,
    "module_structure" JSONB NOT NULL DEFAULT '[]',
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_instructors" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_instructors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "student_id" UUID,
    "invite_token" TEXT NOT NULL,
    "invited_email" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubrics" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scale_type" "RubricScaleType" NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "max_score" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "module_tag" TEXT NOT NULL,
    "point_value" INTEGER NOT NULL,
    "completion_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "due_at" TIMESTAMPTZ(6),
    "template_repo" TEXT NOT NULL,
    "assignment_repo_name" TEXT NOT NULL,
    "github_org" TEXT NOT NULL,
    "distributed_at" TIMESTAMPTZ(6),
    "sections" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "repo_full_name" TEXT,
    "repo_url" TEXT,
    "repo_github_login_at_creation" TEXT,
    "pr_number" INTEGER,
    "pr_url" TEXT,
    "head_branch" TEXT,
    "head_sha" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "is_late" BOOLEAN,
    "last_activity_at" TIMESTAMPTZ(6),
    "final_score" DOUBLE PRECISION,
    "final_score_possible" DOUBLE PRECISION,
    "is_complete" BOOLEAN,
    "feedback_markdown" TEXT,
    "graded_by" UUID,
    "graded_at" TIMESTAMPTZ(6),
    "posted_pr_comment_id" BIGINT,
    "salesforce_sync_status" "SalesforceSyncStatus" NOT NULL DEFAULT 'PENDING',
    "salesforce_record_id" TEXT,
    "salesforce_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_drafts" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "head_sha" TEXT NOT NULL,
    "status" "GradingDraftStatus" NOT NULL DEFAULT 'GENERATING',
    "error_detail" TEXT,
    "model_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grading_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_draft_sections" (
    "id" UUID NOT NULL,
    "grading_draft_id" UUID NOT NULL,
    "section_type" TEXT NOT NULL,
    "report_markdown" TEXT,
    "score_earned" DOUBLE PRECISION,
    "score_possible" DOUBLE PRECISION,
    "rubric_items" JSONB NOT NULL DEFAULT '[]',
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" "Confidence",
    "submission_process_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grading_draft_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_instructors_course_id_user_id_key" ON "course_instructors"("course_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_invite_token_key" ON "enrollments"("invite_token");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_course_id_student_id_key" ON "enrollments"("course_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "rubrics_name_key" ON "rubrics"("name");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_course_id_assignment_repo_name_key" ON "assignments"("course_id", "assignment_repo_name");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_repo_full_name_key" ON "submissions"("repo_full_name");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_assignment_id_student_id_key" ON "submissions"("assignment_id", "student_id");

-- CreateIndex
CREATE INDEX "grading_drafts_submission_id_head_sha_idx" ON "grading_drafts"("submission_id", "head_sha");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_github_user_id_key" ON "profiles"("github_user_id");

-- AddForeignKey
ALTER TABLE "course_instructors" ADD CONSTRAINT "course_instructors_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_instructors" ADD CONSTRAINT "course_instructors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_drafts" ADD CONSTRAINT "grading_drafts_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_draft_sections" ADD CONSTRAINT "grading_draft_sections_grading_draft_id_fkey" FOREIGN KEY ("grading_draft_id") REFERENCES "grading_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Supabase integration (hand-written; not generated from schema.prisma)
-- ---------------------------------------------------------------------------

-- Deny all browser access to these tables.
--
-- Supabase's default privileges grant every permission on new tables in the
-- `public` schema to the `anon` and `authenticated` database roles. That is the
-- same configuration that let a signed-in student change their own
-- profiles.role to ADMIN from browser JavaScript, fixed in
-- 20260730024911_tighten_profiles_grants.
--
-- Unlike profiles, none of these tables are ever read directly by supabase-js
-- in the browser. All access goes through tRPC, which uses Prisma, which
-- connects as the table owner and is therefore not restricted by row level
-- security. So the correct configuration is to remove browser access entirely:
-- REVOKE removes the table privileges, and enabling row level security with
-- zero policies denies access by default even if a privilege is granted later.
--
-- Consequence to be aware of: this means these tables cannot be queried from
-- the browser with supabase-js at all. Authorization lives in exactly one
-- place, which is procedure code in trpc/routers/.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'courses',
    'course_instructors',
    'enrollments',
    'rubrics',
    'assignments',
    'submissions',
    'grading_drafts',
    'grading_draft_sections'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Record GitHub's numeric user ID alongside the login handle.
--
-- auth.identities.provider_id holds the provider's own user identifier as text.
-- For GitHub that is the numeric account ID, which never changes even if the
-- user renames their account. The login handle in github_username does change,
-- which is why it must not be used as an identity key.
--
-- The regex guard matters: provider_id is a text column and other providers put
-- non-numeric values in it (Supabase's own email provider stores the user's
-- UUID there). Casting without checking would raise and break the login.
CREATE OR REPLACE FUNCTION "public"."sync_github_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_handle  text;
  v_user_id bigint;
BEGIN
  IF NEW."provider" IS DISTINCT FROM 'github' THEN
    RETURN NEW;
  END IF;

  v_handle := COALESCE(
    NULLIF(NEW."identity_data" ->> 'user_name', ''),
    NULLIF(NEW."identity_data" ->> 'preferred_username', '')
  );

  IF NEW."provider_id" ~ '^[0-9]+$' THEN
    v_user_id := NEW."provider_id"::bigint;
  END IF;

  IF v_handle IS NULL AND v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Do not move a handle that another profile already owns.
  IF v_handle IS NOT NULL AND EXISTS (
    SELECT 1 FROM "public"."profiles"
    WHERE "github_username" = v_handle AND "id" <> NEW."user_id"
  ) THEN
    v_handle := NULL;
  END IF;

  IF v_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM "public"."profiles"
    WHERE "github_user_id" = v_user_id AND "id" <> NEW."user_id"
  ) THEN
    v_user_id := NULL;
  END IF;

  BEGIN
    UPDATE "public"."profiles"
    SET "github_username" = COALESCE(v_handle, "github_username"),
        "github_user_id"  = COALESCE(v_user_id, "github_user_id"),
        "avatar_url" = COALESCE(
          "avatar_url",
          NULLIF(NEW."identity_data" ->> 'avatar_url', '')
        ),
        "display_name" = COALESCE(
          "display_name",
          NULLIF(NEW."identity_data" ->> 'full_name', ''),
          NULLIF(NEW."identity_data" ->> 'name', ''),
          v_handle
        )
    WHERE "id" = NEW."user_id";
  EXCEPTION WHEN unique_violation THEN
    -- Lost a race for the handle or the numeric ID. Linking a GitHub account
    -- must not fail because of these columns.
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- Backfill the numeric ID for GitHub identities that already exist.
UPDATE "public"."profiles" p
SET "github_user_id" = i."provider_id"::bigint
FROM "auth"."identities" i
WHERE i."user_id" = p."id"
  AND i."provider" = 'github'
  AND i."provider_id" ~ '^[0-9]+$'
  AND p."github_user_id" IS NULL;
