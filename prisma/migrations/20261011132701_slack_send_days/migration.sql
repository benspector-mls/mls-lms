-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "slack_event_days" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
ADD COLUMN     "slack_summary_days" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[];


-- A weekly digest is a digest on one day. Everybody who chose WEEKLY keeps the day they chose and
-- moves to DAILY, which now reads the list of days, so no cadence other than IMMEDIATE, DAILY and
-- OFF is left for the application to handle.
UPDATE "profiles"
SET "slack_event_days" = ARRAY["slack_event_weekday"], "slack_event_cadence" = 'DAILY'
WHERE "slack_event_cadence" = 'WEEKLY';

UPDATE "profiles"
SET "slack_summary_days" = ARRAY["slack_summary_weekday"], "slack_summary_cadence" = 'DAILY'
WHERE "slack_summary_cadence" = 'WEEKLY';

-- Each list holds days and at least one of them. An empty list would mean "never send", which OFF
-- already says, and a null would be read by `has` as matching no day at all. Prisma cannot mark a
-- list column NOT NULL, so the CHECK states it.
ALTER TABLE public."profiles"
  ADD CONSTRAINT "profiles_slack_days_are_days"
  CHECK (
    "slack_event_days" IS NOT NULL
    AND cardinality("slack_event_days") >= 1
    AND "slack_event_days" <@ ARRAY[0,1,2,3,4,5,6]
    AND "slack_summary_days" IS NOT NULL
    AND cardinality("slack_summary_days") >= 1
    AND "slack_summary_days" <@ ARRAY[0,1,2,3,4,5,6]
  );
