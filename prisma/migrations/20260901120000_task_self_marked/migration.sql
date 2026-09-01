-- Whether a fellow may mark a task done themselves, or only their instructor may.
--
-- Some tasks are attested rather than self-reported: a laptop an instructor looks over, a form
-- only they can see the responses to. Before this, every task was self-marked and an instructor
-- could only correct a fellow after the fact.
--
-- Nullable, and null for every kind but TASK, which is the same shape `template_drive_url` has
-- for GOOGLE_DRIVE: "required for one kind" is not something a column can say, so the Zod schema
-- in lib/assignments/spec.ts says it instead. A NOT NULL with a default would make every
-- repository assignment carry an answer to a question about marking that does not apply to it.
--
-- The backfill is what keeps existing tasks working: they were all self-marked, because that was
-- the only thing a task could be, so `true` is not a guess about them — it is what they did.

ALTER TABLE "public"."assignments" ADD COLUMN "student_may_mark_done" BOOLEAN;

UPDATE "public"."assignments" SET "student_may_mark_done" = true WHERE "kind" = 'TASK';
