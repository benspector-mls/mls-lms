-- CreateEnum
CREATE TYPE "NotificationCadence" AS ENUM ('IMMEDIATE', 'DAILY', 'WEEKLY', 'OFF');

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "slack_cadence" "NotificationCadence" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "slack_digested_to" TIMESTAMPTZ(6),
ADD COLUMN     "slack_email" TEXT,
ADD COLUMN     "slack_lookup_failed_at" TIMESTAMPTZ(6),
ADD COLUMN     "slack_user_id" TEXT;

