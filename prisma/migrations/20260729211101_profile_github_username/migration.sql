-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "github_username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "profiles_github_username_key" ON "profiles"("github_username");

-- ---------------------------------------------------------------------------
-- Supabase integration (hand-written; not generated from schema.prisma)
-- ---------------------------------------------------------------------------

-- Populate github_username on signup.
--
-- Two things worth noting:
--
-- 1. The provider is read from raw_app_meta_data (NOT raw_user_meta_data) and
--    checked against 'github'. Other OAuth providers also send
--    `preferred_username`, and storing e.g. an Azure handle in a column named
--    github_username would be quietly wrong.
--
-- 2. github_username is UNIQUE, so a collision would raise and abort the INSERT
--    — which, in an AFTER INSERT trigger on auth.users, would fail the signup
--    itself. Availability of signup matters more than completeness of this one
--    column, so a collision falls back to a NULL handle instead of erroring.
--    The EXCEPTION block also covers the race between the check and the insert.
CREATE OR REPLACE FUNCTION "public"."handle_new_user"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider text;
  v_handle   text;
  v_name     text;
  v_avatar   text;
BEGIN
  v_provider := NEW."raw_app_meta_data" ->> 'provider';

  IF v_provider = 'github' THEN
    v_handle := COALESCE(
      NULLIF(NEW."raw_user_meta_data" ->> 'user_name', ''),
      NULLIF(NEW."raw_user_meta_data" ->> 'preferred_username', '')
    );
  END IF;

  v_name := COALESCE(
    NULLIF(NEW."raw_user_meta_data" ->> 'display_name', ''),
    NULLIF(NEW."raw_user_meta_data" ->> 'full_name', ''),
    NULLIF(NEW."raw_user_meta_data" ->> 'name', ''),
    NULLIF(NEW."raw_user_meta_data" ->> 'user_name', ''),
    NULLIF(NEW."raw_user_meta_data" ->> 'preferred_username', ''),
    NULLIF(split_part(COALESCE(NEW."email", ''), '@', 1), '')
  );

  v_avatar := COALESCE(
    NULLIF(NEW."raw_user_meta_data" ->> 'avatar_url', ''),
    NULLIF(NEW."raw_user_meta_data" ->> 'picture', '')
  );

  -- Drop the handle up front if it is already claimed.
  IF v_handle IS NOT NULL AND EXISTS (
    SELECT 1 FROM "public"."profiles" WHERE "github_username" = v_handle
  ) THEN
    v_handle := NULL;
  END IF;

  BEGIN
    INSERT INTO "public"."profiles"
      ("id", "email", "display_name", "avatar_url", "github_username")
    VALUES (NEW."id", NEW."email", v_name, v_avatar, v_handle)
    ON CONFLICT ("id") DO NOTHING;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a race for the handle. Keep the signup working without it.
    INSERT INTO "public"."profiles"
      ("id", "email", "display_name", "avatar_url", "github_username")
    VALUES (NEW."id", NEW."email", v_name, v_avatar, NULL)
    ON CONFLICT ("id") DO NOTHING;
  END;

  RETURN NEW;
END;
$$;

-- Backfill anyone who already signed up through GitHub before this column
-- existed. DISTINCT ON keeps the earliest account if a handle somehow repeats,
-- so the unique index cannot be violated here.
WITH github_users AS (
  SELECT DISTINCT ON (handle) id, handle
  FROM (
    SELECT u."id",
           COALESCE(
             NULLIF(u."raw_user_meta_data" ->> 'user_name', ''),
             NULLIF(u."raw_user_meta_data" ->> 'preferred_username', '')
           ) AS handle,
           u."created_at"
    FROM "auth"."users" u
    WHERE u."raw_app_meta_data" ->> 'provider' = 'github'
  ) candidates
  WHERE handle IS NOT NULL
  ORDER BY handle, "created_at" ASC
)
UPDATE "public"."profiles" p
SET "github_username" = g.handle
FROM github_users g
WHERE p."id" = g."id"
  AND p."github_username" IS NULL;
