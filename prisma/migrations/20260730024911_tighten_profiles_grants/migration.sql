-- Restrict which COLUMNS the browser may write on public.profiles.
--
-- Why this is needed: RLS policies are row-level only. There is no such thing
-- as a column-level policy. `profiles_update_own` grants "you may update your
-- own row" — and because Supabase's default privileges hand `authenticated`
-- UPDATE on every column, that included `role`. A signed-in student could run
--
--   supabase.from('profiles').update({ role: 'ADMIN' }).eq('id', myUserId)
--
-- straight from browser JavaScript and become an admin. The same call could
-- overwrite `github_username` to hijack another student's repo linkage.
--
-- Postgres DOES support column-level privileges even though policies do not, so
-- that is the fix: revoke the broad grants and re-grant only the two columns a
-- user has any business editing about themselves.
--
-- Division of labour after this migration:
--   * grants   -> which COLUMNS the browser may touch
--   * policies -> which ROWS  the browser may touch
--   * Prisma   -> connects as table owner, bypasses both (trusted server code)
--
-- NOTE: this fixes public.profiles only. Supabase's ALTER DEFAULT PRIVILEGES
-- will still grant ALL to anon/authenticated on any FUTURE table in `public`.
-- Changing that project-wide was deliberately deferred.

REVOKE UPDATE, INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE "public"."profiles" FROM authenticated;

-- anon (logged out) has no business touching profiles at all. No policy grants
-- it anything today, so this is defence in depth rather than a behaviour change.
REVOKE ALL ON TABLE "public"."profiles" FROM anon;

-- Reads are still gated to the caller's own row by profiles_select_own.
GRANT SELECT ON TABLE "public"."profiles" TO authenticated;

-- The only self-service writes. role, github_username, email, id, and the
-- timestamps are now unreachable from the browser at the privilege level,
-- regardless of what any current or future RLS policy permits.
GRANT UPDATE ("display_name", "avatar_url")
  ON TABLE "public"."profiles" TO authenticated;
