-- CreateEnum
CREATE TYPE "SubmissionCommentAuthor" AS ENUM ('STUDENT', 'INSTRUCTOR');

-- CreateTable
CREATE TABLE "submission_comments" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "author_id" UUID,
    "author_role" "SubmissionCommentAuthor" NOT NULL,
    "grading_draft_id" UUID,
    "body" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_comment_reads" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_comment_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submission_comments_submission_id_created_at_idx" ON "submission_comments"("submission_id", "created_at");

-- CreateIndex
CREATE INDEX "submission_comments_author_id_created_at_idx" ON "submission_comments"("author_id", "created_at");

-- CreateIndex
CREATE INDEX "submission_comments_grading_draft_id_idx" ON "submission_comments"("grading_draft_id");

-- CreateIndex
CREATE INDEX "submission_comment_reads_profile_id_idx" ON "submission_comment_reads"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_comment_reads_submission_id_profile_id_key" ON "submission_comment_reads"("submission_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "grading_drafts_id_submission_id_key" ON "grading_drafts"("id", "submission_id");

-- AddForeignKey
ALTER TABLE "submission_comments" ADD CONSTRAINT "submission_comments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_comments" ADD CONSTRAINT "submission_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_comments" ADD CONSTRAINT "submission_comments_grading_draft_id_submission_id_fkey" FOREIGN KEY ("grading_draft_id", "submission_id") REFERENCES "grading_drafts"("id", "submission_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "submission_comment_reads" ADD CONSTRAINT "submission_comment_reads_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_comment_reads" ADD CONSTRAINT "submission_comment_reads_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ===========================================================================
-- Hand-written from here down. `migrate diff` cannot see any of it, so it
-- survives rather than being proposed for removal on the next migration.
--
-- The composite foreign key holding a comment's round to its own submission is
-- deliberately not here: a foreign key is something `migrate diff` can see, so
-- it is declared in schema.prisma instead.
-- ===========================================================================

-- A comment has something in it, and is not a book. The same number is
-- `MAX_COMMENT_LENGTH`; this is here as well because a script does not run the
-- application's code. `btrim` on the lower bound only.
ALTER TABLE public."submission_comments"
  ADD CONSTRAINT "submission_comments_body_has_content"
  CHECK (char_length(btrim("body")) >= 1 AND char_length("body") <= 5000);

-- A thread hangs off the row holding the work, never a mirror. This is the
-- whole of "a team shares one conversation", said by the database: a comment on
-- a mirror would found a second thread the rest of the team cannot see.
--
-- A trigger rather than a CHECK, because a CHECK cannot read another row; the
-- precedent is `submissions_mirror_depth_is_one` above it.
--
-- It fires on writes to these tables rather than to `submissions`, so a row that
-- becomes a mirror later is not refused; those comments resolve away instead.
CREATE OR REPLACE FUNCTION public."submission_comments_not_on_a_mirror"()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."submissions"
    WHERE "id" = NEW."submission_id" AND "team_submission_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'a submission comment cannot hang off a team mirror'
      USING HINT = 'Resolve through team_submission_id to the row holding the team''s work.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "submission_comments_on_the_work"
  BEFORE INSERT OR UPDATE OF "submission_id" ON public."submission_comments"
  FOR EACH ROW EXECUTE FUNCTION public."submission_comments_not_on_a_mirror"();

-- The same for read receipts: one against a mirror is a receipt about a thread
-- that does not exist, so a member would be told there was something new forever.
CREATE TRIGGER "submission_comment_reads_on_the_work"
  BEFORE INSERT OR UPDATE OF "submission_id" ON public."submission_comment_reads"
  FOR EACH ROW EXECUTE FUNCTION public."submission_comments_not_on_a_mirror"();

-- Deny all browser access, as on every other table here: Supabase grants every
-- permission on `public` to `anon` and `authenticated`, and all access goes
-- through tRPC and Prisma, which connects as the owner.
--
-- `submission_comments` is the second table one fellow reads another through,
-- after `team_memberships`. What they may see is decided by the procedures.
REVOKE ALL ON TABLE public."submission_comments" FROM anon, authenticated;
ALTER TABLE public."submission_comments" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."submission_comment_reads" FROM anon, authenticated;
ALTER TABLE public."submission_comment_reads" ENABLE ROW LEVEL SECURITY;
