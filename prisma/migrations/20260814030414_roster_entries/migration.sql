-- CreateTable
CREATE TABLE "roster_entries" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "github_username" TEXT,
    "email" TEXT,
    "note" TEXT,
    "claimed_by_id" UUID,
    "claimed_at" TIMESTAMPTZ(6),
    "added_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roster_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roster_entries_course_id_idx" ON "roster_entries"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "roster_entries_course_id_github_username_key" ON "roster_entries"("course_id", "github_username");

-- CreateIndex
CREATE UNIQUE INDEX "roster_entries_course_id_email_key" ON "roster_entries"("course_id", "email");

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_claimed_by_id_fkey" FOREIGN KEY ("claimed_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Supabase integration (hand-written; not generated from schema.prisma)
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public."roster_entries" FROM anon, authenticated;
ALTER TABLE public."roster_entries" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- The two invariants the Prisma schema cannot state
-- ---------------------------------------------------------------------------

-- **An entry with neither key matches nobody and admits nobody.** It would sit on the roster
-- looking like a student who has not joined yet, and no amount of signing in would ever clear it.
-- Cheaper to make it unrepresentable than to explain it on a screen.
ALTER TABLE public."roster_entries"
  ADD CONSTRAINT "roster_entries_needs_a_key"
  CHECK ("github_username" IS NOT NULL OR "email" IS NOT NULL);

-- **Both keys are stored lowercased**, because both are matched case-insensitively: GitHub logins
-- are case-insensitive, and the handle the signup trigger captures preserves whatever casing
-- GitHub reported. The application lowercases on the way in; this is what makes that a fact about
-- the column rather than a habit of one insert path.
--
-- Stated as a constraint rather than done in a trigger on purpose. A trigger that quietly
-- rewrites the value would make a mismatched lookup elsewhere in the application succeed by
-- accident and hide the real bug, which is a caller that forgot to lowercase what it searched for.
ALTER TABLE public."roster_entries"
  ADD CONSTRAINT "roster_entries_keys_are_lowercase"
  CHECK (
    ("github_username" IS NULL OR "github_username" = lower("github_username"))
    AND ("email" IS NULL OR "email" = lower("email"))
  );

-- `claimed_by_id` and `claimed_at` are set together or not at all: a claimed entry with no
-- timestamp cannot say when somebody joined on it, and a timestamp with no profile names nobody.
ALTER TABLE public."roster_entries"
  ADD CONSTRAINT "roster_entries_claim_is_whole"
  CHECK (("claimed_by_id" IS NULL) = ("claimed_at" IS NULL));
