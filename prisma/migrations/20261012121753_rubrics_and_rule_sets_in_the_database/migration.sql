-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "answer_key_doc_url" TEXT,
ADD COLUMN     "exemplar_doc_url" TEXT;

-- AlterTable
ALTER TABLE "grading_draft_sections" ADD COLUMN     "rubric_version_id" UUID,
ADD COLUMN     "rule_set_version_id" UUID;

-- AlterTable
ALTER TABLE "programs" ADD COLUMN     "rule_set_id" UUID;

-- AlterTable
ALTER TABLE "rubrics" ADD COLUMN     "created_by" UUID,
ADD COLUMN     "current_version_id" UUID,
ADD COLUMN     "rule_set_id" UUID;

-- CreateTable
CREATE TABLE "rubric_versions" (
    "id" UUID NOT NULL,
    "rubric_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "rubric_markdown" TEXT NOT NULL,
    "guidance_markdown" TEXT NOT NULL,
    "sample_report_markdown" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rubric_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_sets" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" UUID,
    "current_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_set_versions" (
    "id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "markdown" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_set_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rubric_versions_rubric_id_number_key" ON "rubric_versions"("rubric_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "rule_sets_name_key" ON "rule_sets"("name");

-- CreateIndex
CREATE UNIQUE INDEX "rule_sets_current_version_id_key" ON "rule_sets"("current_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_set_versions_rule_set_id_number_key" ON "rule_set_versions"("rule_set_id", "number");

-- CreateIndex
CREATE INDEX "grading_draft_sections_rubric_version_id_idx" ON "grading_draft_sections"("rubric_version_id");

-- CreateIndex
CREATE INDEX "grading_draft_sections_rule_set_version_id_idx" ON "grading_draft_sections"("rule_set_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "rubrics_current_version_id_key" ON "rubrics"("current_version_id");

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "rule_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "rubric_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "rule_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_rubric_id_fkey" FOREIGN KEY ("rubric_id") REFERENCES "rubrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "rule_set_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_set_versions" ADD CONSTRAINT "rule_set_versions_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_draft_sections" ADD CONSTRAINT "grading_draft_sections_rubric_version_id_fkey" FOREIGN KEY ("rubric_version_id") REFERENCES "rubric_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_draft_sections" ADD CONSTRAINT "grading_draft_sections_rule_set_version_id_fkey" FOREIGN KEY ("rule_set_version_id") REFERENCES "rule_set_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Three new tables, and the same two statements every table in this schema gets: nothing in them
-- is readable by the browser's Supabase roles, and row level security is on so that a policy
-- somebody adds later is the only way through. Prisma connects as the owner and is unaffected.
REVOKE ALL ON TABLE public."rubric_versions" FROM anon, authenticated;
ALTER TABLE public."rubric_versions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."rule_sets" FROM anon, authenticated;
ALTER TABLE public."rule_sets" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."rule_set_versions" FROM anon, authenticated;
ALTER TABLE public."rule_set_versions" ENABLE ROW LEVEL SECURITY;
