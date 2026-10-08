-- CreateEnum
CREATE TYPE "SummaryCadence" AS ENUM ('DAILY', 'WEEKLY', 'OFF');

-- One cadence became two: one for events on your own work, one for a summary of what is
-- outstanding. Renamed rather than dropped and recreated, so that anybody who had already chosen
-- a cadence keeps the choice they made.
ALTER TABLE "profiles" RENAME COLUMN "slack_cadence" TO "slack_event_cadence";

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "slack_summary_cadence" "SummaryCadence" NOT NULL DEFAULT 'OFF';
