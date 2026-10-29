-- The three defaults on a session's form columns existed for the release before forms were
-- templates, whose inserts did not know the columns: they let that release start a draft during
-- a deploy and gave it the fixed form. The application now writes all three itself, from the form
-- the coach chose, on every start. With the defaults gone, an insert that names no form fails
-- rather than quietly running a session through a form nobody chose, which is what NOT NULL
-- without a default is for. No row changes.

-- AlterTable
ALTER TABLE "coaching_sessions" ALTER COLUMN "layout" DROP DEFAULT,
ALTER COLUMN "template_id" DROP DEFAULT,
ALTER COLUMN "template_name" DROP DEFAULT;
