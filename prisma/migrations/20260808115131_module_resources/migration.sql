-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('LINK', 'TEXT', 'VIDEO');

-- CreateEnum
CREATE TYPE "VideoProvider" AS ENUM ('YOUTUBE', 'VIMEO');

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "description" TEXT,
    "body" TEXT,
    "video_provider" "VideoProvider",
    "video_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resources_module_id_idx" ON "resources"("module_id");

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Not reachable from the browser.
--
-- Supabase's default grants give the `anon` and `authenticated` roles access to everything
-- in the `public` schema, and this table is never read directly by supabase-js. All access
-- goes through tRPC, which uses Prisma, which connects as the table owner and is therefore
-- not restricted by row level security.
--
-- REVOKE removes the table privileges; enabling row level security with zero policies denies
-- access by default even if a privilege is granted later.
--
-- Nothing here is secret — a resource is a reading an instructor wants read — but the rule
-- that decides who sees one still lives in a procedure, and a table the browser can query
-- directly is a second answer to that question.
REVOKE ALL ON TABLE public."resources" FROM anon, authenticated;
ALTER TABLE public."resources" ENABLE ROW LEVEL SECURITY;
