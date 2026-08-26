-- `programs.matriculation` becomes `programs.term`.

-- The column holds a term as a person says it — "Fall 2026" — and every screen now calls it that.
-- It was called `matriculation` because the word was doing two jobs at once: naming the program a
-- fellow is admitted to, and naming the term that program runs in. The first job belongs to
-- `programs` itself, so the column keeps only the second and takes the plain name for it.
--
-- **A rename, not a drop and an add.** `prisma migrate diff` proposes DROP COLUMN followed by ADD
-- COLUMN because it compares end states and cannot see that one column became another; replaying
-- that would empty the column on every row. The end state is identical either way, so the check in
-- step 5 of the authoring recipe still reports no difference.
--
-- The unique index is renamed rather than dropped and rebuilt, which keeps the name Prisma expects
-- and avoids a second full scan of the table to prove a constraint that already holds.

ALTER TABLE public."programs" RENAME COLUMN "matriculation" TO "term";

ALTER INDEX public."programs_name_matriculation_key" RENAME TO "programs_name_term_key";
