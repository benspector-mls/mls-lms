-- An assignment may be handed in more than one way.
--
-- FILE_UPLOAD and EXTERNAL_URL were never two kinds. Neither hands anything out, neither has an
-- Accept, both are graded by hand, and both refuse AI sections — the single thing separating them
-- was how the work arrived. That is exactly the thing an instructor now needs to be able to name
-- twice for one assignment, so a reflection can be handed in as a document by one student, a deck
-- by another, and a short recording by a third. So they collapse into SELF_DIRECTED, which carries
-- the answer as a set. The same finding renamed GOOGLE_DOC to GOOGLE_DRIVE: a kind named after the
-- only collection method it happened to accept.
--
-- `hand_in_methods` is empty for REPO and GOOGLE_DRIVE and read for neither. Their kind already
-- says how they are handed in, and recording it twice would be a second place to disagree with
-- one fact. `handInMethodsFor` in lib/assignments/spec.ts gives all three answers.

CREATE TYPE "HandInMethod" AS ENUM ('LINK', 'FILE');

ALTER TABLE "assignments"
  ADD COLUMN "hand_in_methods" "HandInMethod"[] NOT NULL DEFAULT '{}';

-- Backfilled while the old kind values are still readable, which is why this comes before the
-- type is rebuilt below. Only the kind that has a choice records one.
UPDATE "assignments" SET "hand_in_methods" = '{LINK}' WHERE "kind" = 'EXTERNAL_URL';
UPDATE "assignments" SET "hand_in_methods" = '{FILE}' WHERE "kind" = 'FILE_UPLOAD';

-- Postgres cannot remove a value from an enum, so the type is rebuilt and the column rewritten
-- through it. Every row keeps the meaning it had: the two collapsing values both become the one
-- kind that replaces them, and REPO and GOOGLE_DRIVE are untouched.
ALTER TYPE "AssignmentKind" RENAME TO "AssignmentKind_old";

CREATE TYPE "AssignmentKind" AS ENUM ('REPO', 'GOOGLE_DRIVE', 'SELF_DIRECTED');

-- The default has to go before the type changes and come back after: Postgres refuses to alter a
-- column whose default is still expressed in the old type.
ALTER TABLE "assignments" ALTER COLUMN "kind" DROP DEFAULT;

ALTER TABLE "assignments" ALTER COLUMN "kind" TYPE "AssignmentKind"
  USING (CASE WHEN "kind"::text IN ('FILE_UPLOAD', 'EXTERNAL_URL')
              THEN 'SELF_DIRECTED' ELSE "kind"::text END)::"AssignmentKind";

ALTER TABLE "assignments" ALTER COLUMN "kind" SET DEFAULT 'REPO';

DROP TYPE "AssignmentKind_old";
