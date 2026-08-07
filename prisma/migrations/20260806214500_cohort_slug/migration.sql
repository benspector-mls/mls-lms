-- A cohort's short name, which prefixes every repository it generates.
--
-- A student's repository becomes `{cohort_slug}-{assignment_repo_name}-{github login}`. Without
-- the prefix the name carries no cohort, so two courses running the same program want the same
-- repository for a student who is in both — which happens when a cohort is copied to be tested,
-- and when a student repeats a module.
--
-- Hand-written because the backfill has to produce something *unique*: the column is about to
-- carry a unique index, and two cohorts can legitimately have terms that slugify the same way.

-- AlterTable
ALTER TABLE "courses" ADD COLUMN "cohort_slug" TEXT;

-- Backfill from the term, the same way `slugifyCohort` does in TypeScript: lowercased,
-- non-alphanumerics collapsed to single hyphens, ends trimmed, capped at 24 characters.
--
-- Written out here rather than called, because a migration cannot reach application code — and
-- should not, since the code is free to change and a migration has to keep meaning what it meant.
UPDATE "courses"
   SET "cohort_slug" = regexp_replace(
         left(
           regexp_replace(
             regexp_replace(lower("cohort_term"), '[^a-z0-9]+', '-', 'g'),
             '^-+|-+$', '', 'g'
           ),
           24
         ),
         '-+$', '', 'g'
       );

-- A term that slugifies to nothing — empty, or written in a script this cannot transliterate —
-- falls back to the course's own id. Ugly and unique, which is the right order of priorities for
-- a value that is about to be NOT NULL and indexed. An instructor renames it.
UPDATE "courses"
   SET "cohort_slug" = 'course-' || left(replace("id"::text, '-', ''), 12)
 WHERE "cohort_slug" IS NULL OR "cohort_slug" = '';

-- Two cohorts whose terms slugify identically. The first keeps the plain slug and the rest get a
-- numbered suffix, so the unique index below cannot fail on data this migration produced.
WITH numbered AS (
    SELECT "id",
           "cohort_slug",
           row_number() OVER (PARTITION BY "cohort_slug" ORDER BY "created_at", "id") AS n
      FROM "courses"
)
UPDATE "courses" c
   SET "cohort_slug" = left(numbered."cohort_slug", 21) || '-' || numbered.n
  FROM numbered
 WHERE numbered."id" = c."id"
   AND numbered.n > 1;

ALTER TABLE "courses" ALTER COLUMN "cohort_slug" SET NOT NULL;

-- CreateIndex
--
-- Globally unique rather than per organization. An assignment names its own `github_org`, so a
-- course does not have one to scope by — and two cohorts sharing a slug in different
-- organizations would still be two things called the same thing in every repository name a person
-- reads. Archived cohorts keep theirs, which means a slug is not reusable years later; that is
-- correct, because their repositories are still there.
CREATE UNIQUE INDEX "courses_cohort_slug_key" ON "courses"("cohort_slug");
