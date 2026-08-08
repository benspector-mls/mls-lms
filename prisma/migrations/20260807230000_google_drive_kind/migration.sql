-- A Google Doc assignment becomes a Google Drive assignment.
--
-- Nothing about how it works changes. A Doc, a Sheet, and a Slides deck are handed out as a
-- `/copy` link built the same way, handed in as a link to the student's own copy, and graded by
-- hand — so they were never three kinds, they were one kind named after the only editor it
-- happened to accept. What widens with this is the URL check in `assignmentSpecSchema`, from one
-- Google editor path to the three that exist.
--
-- Renames rather than a new value and a backfill. Both are metadata-only in Postgres, both keep
-- every existing row exactly as it is, and neither has a window in which a row means something
-- different from what it meant a moment before.

ALTER TYPE "AssignmentKind" RENAME VALUE 'GOOGLE_DOC' TO 'GOOGLE_DRIVE';

ALTER TABLE "assignments" RENAME COLUMN "template_doc_url" TO "template_drive_url";
