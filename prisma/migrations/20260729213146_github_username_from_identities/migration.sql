-- Capture github_username from auth.identities instead of auth.users.
--
-- Why identities: a row is inserted there exactly when a provider is linked to
-- a user. That covers BOTH a first-time GitHub signup AND a GitHub link onto an
-- existing email account — the latter never fires an INSERT on auth.users, so
-- the previous users-only trigger missed it entirely.
--
-- The rejected alternative was AFTER UPDATE on auth.users: `last_sign_in_at`
-- and `updated_at` change on every single login, so it would fire constantly
-- and require diffing raw_app_meta_data to detect an actual link.
--
-- No table changes here, so schema.prisma is unaffected.

CREATE OR REPLACE FUNCTION "public"."sync_github_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_handle text;
BEGIN
  IF NEW."provider" IS DISTINCT FROM 'github' THEN
    RETURN NEW;
  END IF;

  v_handle := COALESCE(
    NULLIF(NEW."identity_data" ->> 'user_name', ''),
    NULLIF(NEW."identity_data" ->> 'preferred_username', '')
  );

  IF v_handle IS NULL THEN
    RETURN NEW;
  END IF;

  -- Already claimed by a different profile: leave it alone rather than move it.
  IF EXISTS (
    SELECT 1 FROM "public"."profiles"
    WHERE "github_username" = v_handle AND "id" <> NEW."user_id"
  ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    UPDATE "public"."profiles"
    SET "github_username" = v_handle,
        -- Fill these in only if the account has nothing better already, so a
        -- user who set a real name on signup does not get it overwritten.
        "avatar_url" = COALESCE(
          "avatar_url",
          NULLIF(NEW."identity_data" ->> 'avatar_url', '')
        ),
        "display_name" = COALESCE(
          "display_name",
          NULLIF(NEW."identity_data" ->> 'full_name', ''),
          NULLIF(NEW."identity_data" ->> 'name', ''),
          v_handle
        )
    WHERE "id" = NEW."user_id"
      AND "github_username" IS DISTINCT FROM v_handle;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a race for the handle. Linking must not fail over this column.
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "on_auth_identity_created" ON "auth"."identities";
CREATE TRIGGER "on_auth_identity_created"
  AFTER INSERT ON "auth"."identities"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_github_identity"();

-- With identities as the single source of truth for the handle, drop the
-- provider-sniffing branch from the users trigger. It keeps creating the
-- profile row (name/avatar/email); the handle now arrives moments later from
-- the identities insert in the same signup transaction.
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
      NULLIF(NEW."raw_user_meta_data" ->> 'name', ''),
      NULLIF(NEW."raw_user_meta_data" ->> 'user_name', ''),
      NULLIF(NEW."raw_user_meta_data" ->> 'preferred_username', ''),
      NULLIF(split_part(COALESCE(NEW."email", ''), '@', 1), '')
    ),
    COALESCE(
      NULLIF(NEW."raw_user_meta_data" ->> 'avatar_url', ''),
      NULLIF(NEW."raw_user_meta_data" ->> 'picture', '')
    )
  )
  ON CONFLICT ("id") DO NOTHING;
  RETURN NEW;
END;
$$;

-- Backfill from existing identity rows (covers anyone who linked GitHub before
-- this trigger existed). DISTINCT ON keeps the earliest claim per handle so the
-- unique index cannot be violated.
WITH github_identities AS (
  SELECT DISTINCT ON (handle) user_id, handle
  FROM (
    SELECT i."user_id",
           COALESCE(
             NULLIF(i."identity_data" ->> 'user_name', ''),
             NULLIF(i."identity_data" ->> 'preferred_username', '')
           ) AS handle,
           i."created_at"
    FROM "auth"."identities" i
    WHERE i."provider" = 'github'
  ) candidates
  WHERE handle IS NOT NULL
  ORDER BY handle, "created_at" ASC
)
UPDATE "public"."profiles" p
SET "github_username" = g.handle
FROM github_identities g
WHERE p."id" = g."user_id"
  AND p."github_username" IS NULL;
