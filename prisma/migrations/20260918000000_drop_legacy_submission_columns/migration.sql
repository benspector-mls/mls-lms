-- The five columns that used to hold a submission's one link or one file.
--
-- What a student hands in has been `submission_artifacts` rows since 20260915000000, and nothing
-- has read or written these since the release that switched over. They were kept so that the
-- release before it could still run, which is what kept rolling that code back possible; that has
-- now soaked, and this is the step that gives it up.
--
-- **The schema has to reach production before this does.** Prisma writes without an explicit
-- select ask the database for every column the generated client knows about, so a client that
-- still lists these columns would ask for them the moment they were gone. Deploy the code that no
-- longer declares them first, then apply this.
--
-- `is_late` is deliberately not here, though the schema no longer declares it either. Dropping it
-- belongs to the change that stopped storing lateness, and it keeps that change's rollback open in
-- the same way these five kept this one's. It is its own decision and its own release.

ALTER TABLE "submissions" DROP COLUMN "submitted_url",
DROP COLUMN "upload_path",
DROP COLUMN "upload_filename",
DROP COLUMN "upload_size_bytes",
DROP COLUMN "upload_content_type";
