-- Profiles whose GitHub login had already been renamed before the rename
-- trigger existed.
--
-- `on_auth_identity_renamed` fires when the login inside
-- `auth.identities.identity_data` changes. Supabase had been rewriting that
-- column on every sign-in all along, so a fellow who renamed their account and
-- signed in before the trigger was created already had the new login on their
-- identity and the old one on their profile. Their next sign-in wrote the same
-- login over itself, which is not a change, and the profile stayed stale.
--
-- This copies the login each GitHub identity holds now onto its profile, under
-- the same rule the trigger applies: a login another profile still holds is
-- left where it is. Supabase links a second GitHub account onto the same user
-- when the two share a verified email, so a user may hold more than one GitHub
-- identity; the one Supabase wrote most recently is the account they signed in
-- with last, and is the one taken.
--
-- No table changes here, so schema.prisma is unaffected.

WITH current_login AS (
  SELECT DISTINCT ON (i."user_id")
         i."user_id",
         COALESCE(
           NULLIF(i."identity_data" ->> 'user_name', ''),
           NULLIF(i."identity_data" ->> 'preferred_username', '')
         ) AS handle
  FROM "auth"."identities" i
  WHERE i."provider" = 'github'
  ORDER BY i."user_id", i."updated_at" DESC NULLS LAST, i."created_at" DESC NULLS LAST
)
UPDATE "public"."profiles" p
SET "github_username" = c.handle
FROM current_login c
WHERE p."id" = c."user_id"
  AND c.handle IS NOT NULL
  AND p."github_username" IS DISTINCT FROM c.handle
  AND NOT EXISTS (
    SELECT 1 FROM "public"."profiles" o
    WHERE o."github_username" = c.handle AND o."id" <> p."id"
  );
