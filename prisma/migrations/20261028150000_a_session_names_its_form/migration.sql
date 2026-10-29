-- A session records which form its layout was copied from: the form's id and its name that day.
-- The name is printed beside the session's date on the fellow's record, and the id is what the
-- Fellows screen's Coaching tab filters by, so sessions run through different forms are never
-- read as one row of answers. Copies rather than a foreign key, as the layout is a copy: a form
-- may be renamed or deleted afterwards and the session keeps saying what it was.
--
-- Every session that exists was run through the one form every session had until forms became
-- templates, which is the seeded default form, so the defaults name it and no row needs a
-- separate backfill. The defaults also cover the previous release's inserts during a deploy, and
-- are dropped with the layout column's default once no instance of that release is answering.

-- AlterTable
ALTER TABLE "coaching_sessions" ADD COLUMN     "template_id" UUID NOT NULL DEFAULT 'c0ac4100-f0a1-4e6e-8d2b-7a3f5e9c1b20',
ADD COLUMN     "template_name" TEXT NOT NULL DEFAULT 'Coaching session';
