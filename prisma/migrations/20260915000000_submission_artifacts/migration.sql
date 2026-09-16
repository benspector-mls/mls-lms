-- A submission holds any number of artifacts: links and files together, shown to the student as
-- a list they add to and remove from. This table is where they live — one row per attachment,
-- hanging off the row that holds the work (a mirror row carries none, and reads them through the
-- row it mirrors).
--
-- This migration only creates the table and copies today's single artifacts into it. The
-- application keeps reading and writing `submitted_url` and the four `upload_*` columns on
-- `submissions` until the code switches over; those columns are dropped in a later release once
-- nothing names them. The old code never touches this table, so the migration is safe to apply
-- while the old code is running.

-- CreateTable
CREATE TABLE "submission_artifacts" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "kind" "HandInMethod" NOT NULL,
    "url" TEXT,
    "upload_path" TEXT,
    "upload_filename" TEXT,
    "upload_size_bytes" INTEGER,
    "upload_content_type" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submission_artifacts_submission_id_created_at_idx" ON "submission_artifacts"("submission_id", "created_at");

-- AddForeignKey
ALTER TABLE "submission_artifacts" ADD CONSTRAINT "submission_artifacts_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one artifact per stored link and one per stored file. Only the row that holds the
-- work carries `submitted_url` or `upload_path` (a mirror carries copies of the filename columns,
-- never the location), so filtering on the location columns selects exactly the rows that own
-- work — team and individual alike. The old model is exclusive-or, so each row yields at most one
-- artifact. NOT EXISTS makes both statements safe to run again, which they will be once after the
-- code deploys, to pick up any hand-in that landed between this migration and the deploy.
--
-- `created_at` takes the submission's `last_activity_at` because the moment the work last moved
-- is the closest fact on the row to when this artifact was attached.
INSERT INTO "submission_artifacts"
  ("id", "submission_id", "kind", "url", "created_at")
SELECT gen_random_uuid(), s."id", 'LINK', s."submitted_url",
       COALESCE(s."last_activity_at", s."updated_at")
FROM "submissions" s
WHERE s."submitted_url" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "submission_artifacts" a WHERE a."submission_id" = s."id");

INSERT INTO "submission_artifacts"
  ("id", "submission_id", "kind", "upload_path", "upload_filename", "upload_size_bytes",
   "upload_content_type", "created_at")
SELECT gen_random_uuid(), s."id", 'FILE', s."upload_path", s."upload_filename",
       s."upload_size_bytes", s."upload_content_type",
       COALESCE(s."last_activity_at", s."updated_at")
FROM "submissions" s
WHERE s."upload_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "submission_artifacts" a WHERE a."submission_id" = s."id");

-- The table is reached only through the application's own connection; Supabase's client roles
-- have no business here, same as every other table.
REVOKE ALL ON TABLE public."submission_artifacts" FROM anon, authenticated;
ALTER TABLE public."submission_artifacts" ENABLE ROW LEVEL SECURITY;
