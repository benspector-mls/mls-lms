-- Broaden the display-name fallback chain for GitHub OAuth signups.
--
-- Email signup puts `display_name` in raw_user_meta_data. GitHub puts
-- `full_name`, `user_name`, `preferred_username`, and `avatar_url` instead —
-- and a GitHub user's email may be private or absent, which made the previous
-- final fallback (the email local-part) resolve to NULL.
--
-- Priority: an explicitly set name, then GitHub's real name, then the GitHub
-- handle, then the email local-part. Handle is effectively always present on a
-- GitHub signup, so display_name should no longer come out NULL.
--
-- Table structure is unchanged, so nothing here affects schema.prisma.

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

-- The trigger itself already points at this function and is unchanged.
