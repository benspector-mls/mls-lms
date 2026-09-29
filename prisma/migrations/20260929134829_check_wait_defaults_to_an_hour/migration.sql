-- A check for understanding's wait between attempts defaults to one hour rather than seven days.
--
-- The column default only, and it changes no row: every check already made keeps the wait its
-- instructor saved, and the application always writes the wait explicitly, so this is only what an
-- insert naming no wait would get. Kept in step with `DEFAULT_RETRY_WAIT_HOURS` in
-- lib/checks/attempts.ts so the two cannot disagree. Either release runs unchanged against it.

-- AlterTable
ALTER TABLE "checks_for_understanding" ALTER COLUMN "retry_wait_hours" SET DEFAULT 1;

