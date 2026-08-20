-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "team_set_id" UUID;

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "handed_in_by" UUID,
ADD COLUMN     "team_id" UUID,
ADD COLUMN     "team_set_id" UUID,
ADD COLUMN     "team_submission_id" UUID;

-- CreateTable
CREATE TABLE "team_sets" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "team_set_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "team_set_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_sets_course_id_name_key" ON "team_sets"("course_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "team_sets_id_course_id_key" ON "team_sets"("id", "course_id");

-- CreateIndex
CREATE INDEX "teams_course_id_idx" ON "teams"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_team_set_id_name_key" ON "teams"("team_set_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_team_set_id_position_key" ON "teams"("team_set_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "teams_id_team_set_id_key" ON "teams"("id", "team_set_id");

-- CreateIndex
CREATE INDEX "team_memberships_enrollment_id_idx" ON "team_memberships"("enrollment_id");

-- CreateIndex
CREATE INDEX "team_memberships_team_id_idx" ON "team_memberships"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_memberships_team_set_id_enrollment_id_key" ON "team_memberships"("team_set_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "assignments_team_set_id_idx" ON "assignments"("team_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_id_team_set_id_key" ON "assignments"("id", "team_set_id");

-- CreateIndex
CREATE INDEX "submissions_team_submission_id_idx" ON "submissions"("team_submission_id");

-- CreateIndex
CREATE INDEX "submissions_team_id_idx" ON "submissions"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_id_assignment_id_key" ON "submissions"("id", "assignment_id");

-- AddForeignKey
ALTER TABLE "team_sets" ADD CONSTRAINT "team_sets_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_team_set_id_course_id_fkey" FOREIGN KEY ("team_set_id", "course_id") REFERENCES "team_sets"("id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_team_set_id_fkey" FOREIGN KEY ("team_id", "team_set_id") REFERENCES "teams"("id", "team_set_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_set_id_course_id_fkey" FOREIGN KEY ("team_set_id", "course_id") REFERENCES "team_sets"("id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_enrollment_id_course_id_fkey" FOREIGN KEY ("enrollment_id", "course_id") REFERENCES "enrollments"("id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_team_set_id_course_id_fkey" FOREIGN KEY ("team_set_id", "course_id") REFERENCES "team_sets"("id", "course_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_handed_in_by_fkey" FOREIGN KEY ("handed_in_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_team_id_team_set_id_fkey" FOREIGN KEY ("team_id", "team_set_id") REFERENCES "teams"("id", "team_set_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_team_set_id_fkey" FOREIGN KEY ("assignment_id", "team_set_id") REFERENCES "assignments"("id", "team_set_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_team_submission_id_assignment_id_fkey" FOREIGN KEY ("team_submission_id", "assignment_id") REFERENCES "submissions"("id", "assignment_id") ON DELETE NO ACTION ON UPDATE NO ACTION;



-- ===========================================================================
-- Hand-written from here down. None of it is expressible in schema.prisma, and
-- `migrate diff` cannot see any of it — so it survives rather than being
-- proposed for removal on the next migration.
--
-- The one constraint that is *not* here is the foreign key holding a
-- submission's team set to its assignment's. A foreign key is something
-- `migrate diff` can see, so leaving it here would mean being asked to drop it
-- on every future migration until somebody said yes. It is declared in
-- schema.prisma instead, as `Submission.assignmentTeamSet`.
-- ===========================================================================

-- Exactly one row per team per assignment holds the work.
--
-- The rest of a team's rows are mirrors pointing at it. Without this, two Accepts arriving in the
-- same moment would create two rows holding two repositories for one team, and both would be
-- graded. Prisma cannot express a partial index, so this is hand-written.
--
-- It is also what the accept path leans on to settle that race: the loser is refused by this
-- index, re-reads, and joins the team the winner created.
CREATE UNIQUE INDEX "submissions_one_row_per_team"
  ON public."submissions" ("assignment_id", "team_id")
  WHERE "team_submission_id" IS NULL AND "team_id" IS NOT NULL;

-- A team and its set are written together or not at all, in the spirit of
-- `roster_entries_claim_is_whole`. Half of the pair is a row that neither belongs to a team nor
-- is individual work, and every query reading one column would disagree with every query reading
-- the other.
ALTER TABLE public."submissions"
  ADD CONSTRAINT "submissions_team_is_whole"
  CHECK (("team_id" IS NULL) = ("team_set_id" IS NULL));

-- A mirror is a copy of a team's work, so it has a team by definition.
ALTER TABLE public."submissions"
  ADD CONSTRAINT "submissions_a_mirror_has_a_team"
  CHECK ("team_submission_id" IS NULL OR "team_id" IS NOT NULL);

-- A row is not a mirror of itself. The composite foreign key is satisfied by pointing at one's
-- own id, and a row that did would be both its team's work and a copy of it.
ALTER TABLE public."submissions"
  ADD CONSTRAINT "submissions_a_mirror_is_not_itself"
  CHECK ("team_submission_id" IS NULL OR "team_submission_id" <> "id");

-- No chain of mirrors: what a mirror points at is what holds the work.
--
-- A trigger rather than a CHECK, because a CHECK cannot read another row; the precedent is the
-- append-only trigger on `audit_events`. Both directions are refused — a mirror of a mirror, and
-- turning a row that already has mirrors into one — because either leaves a team's grade one hop
-- further from the row every screen resolves to, and the fan-out that copies a grade onto mirrors
-- only ever looks one hop.
CREATE OR REPLACE FUNCTION public."submissions_mirror_depth_is_one"()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW."team_submission_id" IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."submissions"
    WHERE "id" = NEW."team_submission_id" AND "team_submission_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'a submission cannot mirror one that is itself a mirror'
      USING HINT = 'Point it at the row holding the team''s work.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."submissions" WHERE "team_submission_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'a submission with mirrors of its own cannot become a mirror'
      USING HINT = 'Move its mirrors to the team''s row first.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "submissions_mirror_depth"
  BEFORE INSERT OR UPDATE OF "team_submission_id" ON public."submissions"
  FOR EACH ROW EXECUTE FUNCTION public."submissions_mirror_depth_is_one"();

-- Deny all browser access to the three new tables, for the same reason as every other table
-- here: Supabase's default privileges grant every permission on tables in the `public` schema to
-- `anon` and `authenticated`, and none of these is ever read directly by supabase-js. All access
-- goes through tRPC, which uses Prisma, which connects as the table owner and is therefore not
-- restricted by row level security.
--
-- `team_memberships` is the one to notice. It is the first table here that one student reads
-- anything of another student through, since the members of a team can see each other. Exactly
-- what they may see is decided by the procedure; this is what leaves no second route to the rows.
REVOKE ALL ON TABLE public."team_sets" FROM anon, authenticated;
ALTER TABLE public."team_sets" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."teams" FROM anon, authenticated;
ALTER TABLE public."teams" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."team_memberships" FROM anon, authenticated;
ALTER TABLE public."team_memberships" ENABLE ROW LEVEL SECURITY;
