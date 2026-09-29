-- A renamed GitHub account reaches the profile on the next sign-in.
--
-- `sync_github_identity` runs when a GitHub identity is linked and copies the
-- login into `profiles.github_username`. Nothing ran on the sign-ins after
-- that. Supabase's auth server rewrites `auth.identities.identity_data` with
-- what GitHub sent on every OAuth sign-in, so a fellow who renamed their
-- account had the new login sitting in that column and the old one on their
-- profile. Every later accept invited the old login, which GitHub answers
-- with "Resource not accessible by integration", and every pull request they
-- opened was matched against a login GitHub no longer resolves.
--
-- The same function handles the update. It writes the login only when no
-- other profile holds it, keeps the numeric id and the rest of the row as they
-- are, and swallows the unique-violation race, so a rename that collides with
-- somebody's stale login leaves the profile unchanged rather than failing the
-- sign-in. Nothing in it depends on the row being new.
--
-- The trigger is narrowed twice: to the `identity_data` column, because
-- `last_sign_in_at` moves on every sign-in and the login almost never does,
-- and to rows whose login actually changed, so an ordinary sign-in runs no
-- trigger body at all. The expression matches how the function derives the
-- login, or a change in one field the other ignores would fire it for nothing.
--
-- No table changes here, so schema.prisma is unaffected.

DROP TRIGGER IF EXISTS "on_auth_identity_renamed" ON "auth"."identities";
CREATE TRIGGER "on_auth_identity_renamed"
  AFTER UPDATE OF "identity_data" ON "auth"."identities"
  FOR EACH ROW
  WHEN (
    COALESCE(
      NULLIF(OLD."identity_data" ->> 'user_name', ''),
      NULLIF(OLD."identity_data" ->> 'preferred_username', '')
    ) IS DISTINCT FROM COALESCE(
      NULLIF(NEW."identity_data" ->> 'user_name', ''),
      NULLIF(NEW."identity_data" ->> 'preferred_username', '')
    )
  )
  EXECUTE FUNCTION "public"."sync_github_identity"();
