-- AlterTable
ALTER TABLE "course_instructors" ADD COLUMN     "grading_group_id" UUID;

-- CreateTable
CREATE TABLE "course_groups" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_memberships" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_groups_course_id_name_key" ON "course_groups"("course_id", "name");

-- CreateIndex
CREATE INDEX "group_memberships_enrollment_id_idx" ON "group_memberships"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_memberships_group_id_enrollment_id_key" ON "group_memberships"("group_id", "enrollment_id");

-- AddForeignKey
ALTER TABLE "course_instructors" ADD CONSTRAINT "course_instructors_grading_group_id_fkey" FOREIGN KEY ("grading_group_id") REFERENCES "course_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_groups" ADD CONSTRAINT "course_groups_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "course_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Neither table is reachable from the browser.
--
-- Supabase's default grants give the `anon` and `authenticated` roles access to
-- everything in the `public` schema, and neither of these is ever read directly by
-- supabase-js. All access goes through tRPC, which uses Prisma, which connects as the
-- table owner and is therefore not restricted by row level security.
--
-- REVOKE removes the table privileges; enabling row level security with zero policies
-- denies access by default even if a privilege is granted later.
--
-- `group_memberships` is the one that would matter if it leaked. A membership row says
-- which students an instructor has grouped together, and groups are not shown to
-- students at all — reading one from the browser would disclose a slice of the roster to
-- the cohort.
REVOKE ALL ON TABLE public."course_groups" FROM anon, authenticated;
ALTER TABLE public."course_groups" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."group_memberships" FROM anon, authenticated;
ALTER TABLE public."group_memberships" ENABLE ROW LEVEL SECURITY;
