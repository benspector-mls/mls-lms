-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'INSTRUCTOR', 'ADMIN');

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Supabase integration (hand-written; not generated from schema.prisma)
-- ---------------------------------------------------------------------------

-- Let the PostgREST roles reach the table at all. RLS below is what actually
-- restricts which *rows* they see.
GRANT USAGE ON SCHEMA "public" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."profiles" TO authenticated;
GRANT SELECT ON TABLE "public"."profiles" TO anon;

-- RLS applies to the anon/authenticated roles used by supabase-js in the
-- browser. It does NOT constrain Prisma, which connects as the table owner and
-- bypasses RLS by design — Prisma is trusted server-side code.
ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON "public"."profiles" FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

CREATE POLICY "profiles_update_own"
  ON "public"."profiles" FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- Deliberately no INSERT or DELETE policy: rows are created by the trigger
-- below and removed by the FK cascade when the auth user is deleted.

-- Auto-provision a profile whenever Supabase Auth creates a user. SECURITY
-- DEFINER so it runs as the owner and is not blocked by RLS. The empty
-- search_path forces every reference below to be schema-qualified.
CREATE OR REPLACE FUNCTION "public"."handle_new_user"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO "public"."profiles" ("id", "email", "display_name", "avatar_url")
  VALUES (
    NEW."id",
    NEW."email",
    COALESCE(
      NULLIF(NEW."raw_user_meta_data" ->> 'display_name', ''),
      NULLIF(NEW."raw_user_meta_data" ->> 'full_name', ''),
      split_part(NEW."email", '@', 1)
    ),
    NULLIF(NEW."raw_user_meta_data" ->> 'avatar_url', '')
  )
  ON CONFLICT ("id") DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
CREATE TRIGGER "on_auth_user_created"
  AFTER INSERT ON "auth"."users"
  FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();
