-- Take the browser roles off every table in `public`, now and in future.
--
-- The gap this closes was named in 20260730024911_tighten_profiles_grants and
-- deliberately left open there: that migration fixed `public.profiles` alone,
-- and noted that Supabase's ALTER DEFAULT PRIVILEGES would go on granting ALL to
-- anon and authenticated on every table created afterwards.
--
-- **The application tables are fine.** The authoring recipe in prisma.config.ts
-- asks for a privilege block by hand on each new table, and it has been followed
-- every time: courses, enrollments, submissions, and the rest grant the browser
-- roles nothing. What this migration changes is that following it stops being
-- necessary — a table added in a hurry is closed rather than open.
--
-- **One table did slip, and it is the one nobody writes a privilege block for.**
-- `_prisma_migrations` is created by Prisma rather than by a migration in this
-- directory, so it inherited the permissive default: SELECT, INSERT, UPDATE,
-- DELETE, and TRUNCATE to both anon and authenticated, with no RLS behind it.
-- Everything in `public` is reachable through PostgREST, so that is a table any
-- signed-in user could empty from browser JavaScript. No student data sits in it;
-- what it costs is the migration history, and a `migrate deploy` afterwards would
-- try to replay all of it against a database that already has the tables.
--
-- **Nothing in the browser reads a table, so this costs nothing.** The
-- browser-side Supabase client is constructed in five components and used only
-- for auth: signInWithOAuth, signUp, signInWithPassword, password reset, and
-- sign-out. There is no `.from(...)` call in any client component. Every read of
-- application data goes through tRPC, and every write through a procedure, both
-- of which reach Postgres as Prisma — the table owner, which is restricted by
-- none of this.
--
-- Division of labour, unchanged from the earlier migration and now applied
-- everywhere rather than to one table:
--   * grants   -> which COLUMNS the browser may touch  (after this: none)
--   * policies -> which ROWS  the browser may touch
--   * Prisma   -> connects as table owner, bypasses both (trusted server code)

-- ---------------------------------------------------------------------------
-- Existing objects
-- ---------------------------------------------------------------------------

-- Guarded because the roles are Supabase's, not this migration history's. A
-- shadow database replaying these migrations has an `auth` schema stubbed by
-- `initShadowDb` but no Supabase roles, and a REVOKE naming a role that does not
-- exist is an error rather than a no-op. Roles are cluster-wide, so whether they
-- are present depends on the cluster rather than the database.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN

    REVOKE ALL ON ALL TABLES    IN SCHEMA "public" FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM anon, authenticated;

    -- USAGE on the schema itself is deliberately left in place. It grants no
    -- access to anything now that the table privileges are gone, and revoking it
    -- makes PostgREST's introspection fail in ways that surface as opaque errors
    -- rather than as permission denials.
    GRANT USAGE ON SCHEMA "public" TO anon, authenticated;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Future objects
-- ---------------------------------------------------------------------------

-- ALTER DEFAULT PRIVILEGES applies only to objects created by the role it names,
-- so naming the wrong one silently does nothing — which is the failure mode this
-- whole migration exists to correct. Both roles that hold a default ACL on this
-- schema are named: `postgres` runs the migrations, and `supabase_admin` owns
-- what Supabase itself creates. current_user covers a local cluster where the
-- developer's own role is the owner.
--
-- **Membership is the guard, not existence.** Altering a role's default
-- privileges requires being a member of that role, and on Supabase the migration
-- user is not a member of `supabase_admin` — so a check for the role merely
-- existing passes and the statement then fails with "permission denied to change
-- default privileges", taking the whole migration down with it. `pg_has_role`
-- asks the question that decides whether the statement can run.
--
-- What that leaves is a table created by `supabase_admin` in this schema, which
-- would still inherit permissive grants. Supabase creates none here — `public` is
-- this application's schema — and one appearing would be a change worth noticing
-- rather than one to pre-empt.
--
-- Supabase sets its own permissive defaults for these same roles. A REVOKE here
-- does not delete their entry; it subtracts from it, which is what makes this
-- durable rather than something Supabase's next default reinstates wholesale.
DO $$
DECLARE
  owner_role text;
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')) THEN
    RETURN;
  END IF;

  FOREACH owner_role IN ARRAY ARRAY['postgres', 'supabase_admin', current_user]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role)
       AND pg_has_role(current_user, owner_role, 'USAGE') THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA "public" '
        'REVOKE ALL ON TABLES FROM anon, authenticated', owner_role);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA "public" '
        'REVOKE ALL ON SEQUENCES FROM anon, authenticated', owner_role);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- What this supersedes
-- ---------------------------------------------------------------------------

-- The column-level `GRANT UPDATE (display_name, avatar_url) ON profiles TO
-- authenticated` from 20260730024911 is revoked by the block above. That is
-- intended and costs nothing: no client component ever used it, and a profile
-- edit would go through a tRPC procedure like every other write in this
-- application. It is called out here so a later reader finds the answer beside
-- the question rather than treating it as collateral damage.
--
-- The RLS policies on `profiles` are left exactly as they are. With no table
-- privileges behind them they can admit nobody, so they are now documentation of
-- an intent and a second lock rather than the lock. Removing them would gain
-- nothing and would take the intent with it.
