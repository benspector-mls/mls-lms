-- Modules become rows an instructor creates, rather than tags derived from the
-- directory names in the answer-keys repository.
--
-- The order below is the whole point of this file, and it is why it is hand-written
-- rather than what `migrate diff` produced. Prisma emits
-- `ADD COLUMN module_id UUID NOT NULL`, which fails outright on a table that already
-- has rows. So: create the table, add the column nullable, derive one module per
-- distinct tag, point every assignment at its module, and only then make the column
-- NOT NULL. The constraint holds from the first moment it exists, and no assignment
-- passes through a state where it belongs to no module.

-- CreateTable
CREATE TABLE "modules" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "modules_course_id_position_idx" ON "modules"("course_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "modules_course_id_name_key" ON "modules"("course_id", "name");

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable for the length of this migration only.
ALTER TABLE "assignments" ADD COLUMN "module_id" UUID;

-- Backfill: one module per distinct tag, from BOTH sources.
--
-- Two sources, because they disagree and both matter. `assignments.module_tag` holds
-- tags that are in use, including ones the course never declared — there is such a row
-- today, which is why editing that assignment currently fails validation.
-- `courses.module_structure` holds what the course declared, including modules nothing
-- has been added to yet, which an instructor would otherwise find missing from the new
-- interface. UNION takes both and dedupes.
--
-- The name is the raw tag. SQL cannot call `moduleLabel`, and inventing a prettier name
-- here would put a second naming rule in a place nobody would look for one. Renaming
-- these to what the modules are actually called is the first thing the new interface is
-- for.
WITH tags AS (
    SELECT "course_id", "module_tag" AS name FROM "assignments"
    UNION
    SELECT c."id", t.tag
      FROM "courses" c
      CROSS JOIN LATERAL jsonb_array_elements_text(c."module_structure"::jsonb) AS t(tag)
)
INSERT INTO "modules" ("id", "course_id", "name", "position", "created_at", "updated_at")
SELECT
    gen_random_uuid(),
    "course_id",
    name,
    -- Ordered by the number the tag starts with, so the sequence survives the move.
    -- Anything that does not look like `mod-<n>` sorts last rather than failing.
    COALESCE((substring(name FROM '^mod-(\d+)'))::int, 999),
    now(),
    now()
FROM tags;

UPDATE "assignments" a
   SET "module_id" = m."id"
  FROM "modules" m
 WHERE m."course_id" = a."course_id"
   AND m."name" = a."module_tag";

-- Every assignment's own tag is in the UNION above by construction, so this cannot
-- fail on data this migration just derived. If it does, the backfill is wrong and
-- stopping here is correct.
ALTER TABLE "assignments" ALTER COLUMN "module_id" SET NOT NULL;

-- AddForeignKey
--
-- RESTRICT rather than CASCADE. Removing a module must never take the assignments in
-- it — and their submissions, and every graded draft beneath those — with it.
-- `modules.remove` refuses while any assignment references the module; this is the
-- database saying the same thing rather than trusting that it was asked.
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deny all browser access to modules, for the same reason as every other table:
-- Supabase's default privileges grant every permission on new tables in the `public`
-- schema to `anon` and `authenticated`, and this table is never read directly by
-- supabase-js. All access goes through tRPC, which uses Prisma, which connects as the
-- table owner and is therefore not restricted by row level security.
--
-- REVOKE removes the table privileges; enabling row level security with zero policies
-- denies access by default even if a privilege is granted later.
REVOKE ALL ON TABLE public."modules" FROM anon, authenticated;
ALTER TABLE public."modules" ENABLE ROW LEVEL SECURITY;
