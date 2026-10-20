-- A preparation summary is a list of themes and nothing else: each theme carries its own status,
-- callout, question, evidence and reasoning in the `themes` column, so the separate prose body is
-- gone. Its length CHECK goes with it, because the constraint names no other column.
--
-- Nothing reads `body` in this release, and no release that read it was ever deployed, so the
-- column can go in the same release that stops writing it.

-- AlterTable
ALTER TABLE "coaching_summaries" DROP COLUMN "body";
