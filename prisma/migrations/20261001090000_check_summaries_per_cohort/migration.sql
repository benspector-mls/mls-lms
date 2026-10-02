-- A check's summary moves off the check and into a table of its own, one row per check and
-- cohort selection. Co-teachers each summarize their own cohort, and one summary per check would
-- have had them overwriting each other. The whole room (`all`) and the fellows in no cohort
-- (`unassigned`) are selections too, so a check may hold one of each beside one per cohort.
--
-- The three columns the previous migration added are dropped. No release has written to them
-- outside a local database: the feature shipped and this change in the same deploy. The row's
-- `cohort_id` is a cascade from `cohorts`, so deleting a cohort removes the summaries written for
-- it rather than leaving rows no picker can reach.

-- AlterTable
ALTER TABLE "checks_for_understanding" DROP COLUMN "summary",
DROP COLUMN "summary_at",
DROP COLUMN "summary_model_metadata";

-- CreateTable
CREATE TABLE "check_summaries" (
    "id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "cohort_key" TEXT NOT NULL,
    "cohort_id" UUID,
    "summary" JSONB NOT NULL,
    "written_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model_metadata" JSONB NOT NULL,

    CONSTRAINT "check_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "check_summaries_check_id_cohort_key_key" ON "check_summaries"("check_id", "cohort_key");

-- AddForeignKey
ALTER TABLE "check_summaries" ADD CONSTRAINT "check_summaries_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "checks_for_understanding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_summaries" ADD CONSTRAINT "check_summaries_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written from here down. `migrate diff` cannot see any of it.

-- Reached only through the application's own connection; Supabase's client roles have no business
-- here, same as every other table.
REVOKE ALL ON TABLE public."check_summaries" FROM anon, authenticated;
ALTER TABLE public."check_summaries" ENABLE ROW LEVEL SECURITY;
