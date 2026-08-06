-- A course carries one join link; an enrollment is created by a student redeeming it.
--
-- This replaces a per-student invite: a unique token on every `enrollments` row, an email
-- recorded before the student existed, and a nullable `student_id` holding "invited but not
-- yet bound". One link per course means an enrollment row is created *by* somebody joining,
-- so none of those three states can occur and all three columns go.
--
-- Hand-written for the enum: Postgres cannot drop a value from a type in place, and leaving
-- `INVITED` behind would be an enum member nothing can produce — a question every future
-- reader has to ask and answer.

-- ---------------------------------------------------------------------------
-- The join token
-- ---------------------------------------------------------------------------

-- Nullable for the length of this migration only.
ALTER TABLE "courses" ADD COLUMN "join_token" TEXT;

-- Existing courses get one, because the column is about to be NOT NULL and a course with no
-- link cannot gain students. Random rather than derived from the id: the token is the only
-- thing standing between a stranger and a cohort, so it must not be guessable from anything
-- that appears in a URL.
UPDATE "courses"
   SET "join_token" = replace(gen_random_uuid()::text, '-', '')
 WHERE "join_token" IS NULL;

ALTER TABLE "courses" ALTER COLUMN "join_token" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "courses_join_token_key" ON "courses"("join_token");

-- ---------------------------------------------------------------------------
-- Enrollments always have a student
-- ---------------------------------------------------------------------------

-- An unbound enrollment is exactly the state this design removes, and it cannot be carried
-- across: there is no student to attach and no invite left to redeem. Deleted rather than
-- guessed at, and counted out loud so the number is not a surprise. Submissions cascade from
-- the enrollment's student rather than from the enrollment, so an unbound row owns no work.
DO $$
DECLARE unbound int;
BEGIN
    SELECT count(*) INTO unbound FROM "enrollments" WHERE "student_id" IS NULL;
    IF unbound > 0 THEN
        RAISE NOTICE 'Deleting % enrollment(s) that were invited and never redeemed.', unbound;
        DELETE FROM "enrollments" WHERE "student_id" IS NULL;
    END IF;
END $$;

-- AlterTable
ALTER TABLE "enrollments" DROP COLUMN "invite_token";
ALTER TABLE "enrollments" DROP COLUMN "invited_email";
ALTER TABLE "enrollments" ALTER COLUMN "student_id" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- EnrollmentStatus loses INVITED
-- ---------------------------------------------------------------------------

-- Nothing should be left in that state after the delete above, since INVITED and unbound were
-- the same condition. Any bound row still carrying it is a row whose student has signed in, so
-- ACTIVE is what it means.
UPDATE "enrollments" SET "status" = 'ACTIVE' WHERE "status" = 'INVITED';

ALTER TYPE "EnrollmentStatus" RENAME TO "EnrollmentStatus_old";
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- The default is dropped before the cast and restored after, because it is typed too: a
-- default of 'INVITED' cannot survive a type that no longer has the value, and Postgres will
-- refuse the ALTER rather than silently discard it.
ALTER TABLE "enrollments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "enrollments"
    ALTER COLUMN "status" TYPE "EnrollmentStatus"
    USING ("status"::text::"EnrollmentStatus");
ALTER TABLE "enrollments" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP TYPE "EnrollmentStatus_old";
