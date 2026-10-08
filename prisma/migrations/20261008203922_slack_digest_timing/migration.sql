-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "slack_event_hour" INTEGER NOT NULL DEFAULT 9,
ADD COLUMN     "slack_event_weekday" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "slack_summary_hour" INTEGER NOT NULL DEFAULT 9,
ADD COLUMN     "slack_summary_weekday" INTEGER NOT NULL DEFAULT 1;

-- A clock time and a weekday are the two things these columns can be, and nothing outside those
-- ranges means anything. Written as CHECKs because the application is not the only thing that
-- writes rows: a script or a hand-run UPDATE reaches the table directly.
ALTER TABLE public."profiles"
  ADD CONSTRAINT "profiles_slack_hours_are_clock_times"
  CHECK (
    "slack_event_hour" BETWEEN 0 AND 23
    AND "slack_summary_hour" BETWEEN 0 AND 23
  );

ALTER TABLE public."profiles"
  ADD CONSTRAINT "profiles_slack_weekdays_are_days"
  CHECK (
    "slack_event_weekday" BETWEEN 0 AND 6
    AND "slack_summary_weekday" BETWEEN 0 AND 6
  );
