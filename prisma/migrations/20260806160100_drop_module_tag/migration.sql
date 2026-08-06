-- The two columns modules used to be kept in.
--
-- `assignments.module_tag` was the course's module and the answer-keys directory at once.
-- `modules` took the first job and `answer_key_repo` with repository-relative paths took
-- the second, so nothing reads either of these.
--
-- Dropped rather than left in place because an unread column is a second answer to a
-- question that already has one, and the next person to add a module would reasonably
-- write to it.

-- AlterTable
ALTER TABLE "assignments" DROP COLUMN "module_tag";

-- AlterTable
ALTER TABLE "courses" DROP COLUMN "module_structure";
