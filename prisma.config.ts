/*
 * ############################################################################
 * # NEVER RUN `prisma db push` ON THIS PROJECT. Use `prisma migrate deploy`. #
 * # `prisma migrate dev` DOES NOT WORK EITHER — it offers to reset the real   #
 * # database. Author migrations with `migrate diff`; recipe at the bottom.    #
 * ############################################################################
 *
 * `db push` ignores the `tables.external` list below. Because the datasource
 * spans the `auth` schema, push diffs ALL of Supabase's auth tables against a
 * datamodel that only declares `auth.users` — and tries to DROP the rest
 * (identities, sessions, refresh_tokens, mfa_*, schema_migrations...). Only
 * Postgres ownership rules stop it, and only partway through.
 *
 * `migrate deploy` just replays the SQL in prisma/migrations, so it is safe.
 */
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Match Next.js env precedence: .env.local wins over .env.
// (dotenv never overwrites an already-set var, so load order == precedence.)
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",

  // Required to declare Supabase-owned tables as external (see `tables.external`).
  experimental: {
    externalTables: true,
  },

  datasource: {
    // Migrations/introspection only. Use the *session* pooler (port 5432) or a
    // direct connection here — the transaction pooler (6543) cannot run DDL.
    //
    // Read via process.env (not Prisma's `env()`) so that `prisma generate`
    // still succeeds on Vercel builds, where only DATABASE_URL is typically set.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,

    // Migration authoring needs a throwaway database to replay history into,
    // and Supabase does not let you CREATE DATABASE over the pooler. Point this
    // at a local Postgres. Not needed for `migrate deploy`, which just replays
    // the SQL in prisma/migrations. See the authoring recipe at the bottom.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },

  tables: {
    // Supabase owns everything in the `auth` schema. Prisma reads auth.users
    // and FKs to it, but must never create, alter, or drop any of these.
    //
    // ALL of them must be listed, not just the ones we model. Anything in the
    // datasource's schemas that Prisma doesn't know about counts as "the schema
    // is not empty" (error P3005) and blocks `migrate deploy` — and would look
    // like drift to `migrate dev`.
    external: [
      "auth.audit_log_entries",
      "auth.custom_oauth_providers",
      "auth.flow_state",
      "auth.identities",
      "auth.instances",
      "auth.mfa_amr_claims",
      "auth.mfa_challenges",
      "auth.mfa_factors",
      "auth.oauth_authorizations",
      "auth.oauth_client_states",
      "auth.oauth_clients",
      "auth.oauth_consents",
      "auth.one_time_tokens",
      "auth.refresh_tokens",
      "auth.saml_providers",
      "auth.saml_relay_states",
      "auth.schema_migrations",
      "auth.sessions",
      "auth.sso_domains",
      "auth.sso_providers",
      "auth.users",
      "auth.webauthn_challenges",
      "auth.webauthn_credentials",
    ],
  },

  migrations: {
    path: "prisma/migrations",

    // The shadow database used for migration diffing is empty, so it has no
    // Supabase-managed `auth` schema. This stub creates just enough of it for
    // every migration in prisma/migrations to replay cleanly. It is NEVER run
    // against a real database.
    //
    // What each piece is here for, so this stays correct as migrations are
    // added: `auth.users` resolves the profiles foreign key; `auth.identities`
    // carries the on_auth_identity_created trigger and the github_user_id
    // backfill; `auth.uid()` appears in the row level security policies on
    // profiles. Anything else a migration touches in the `auth` schema has to
    // be added here too, or `migrate dev` fails with P3006 while the real
    // database is perfectly fine.
    initShadowDb: `
      CREATE SCHEMA IF NOT EXISTS auth;

      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        email text UNIQUE,
        email_confirmed_at timestamptz,
        created_at timestamptz,
        raw_user_meta_data jsonb,
        raw_app_meta_data jsonb
      );

      CREATE TABLE auth.identities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        provider text NOT NULL,
        provider_id text NOT NULL,
        identity_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz,
        updated_at timestamptz
      );

      -- Returns the signed-in user's id in a real Supabase database. The shadow
      -- database never has a request context, so a null-returning stub of the
      -- right signature is all the policies need in order to parse.
      CREATE FUNCTION auth.uid() RETURNS uuid
        LANGUAGE sql STABLE
        AS $$ SELECT NULL::uuid $$;
    `,

    seed: "npx tsx prisma/seed.ts",
  },
});

/*
 * ---------------------------------------------------------------------------
 * How to author a new migration on this project
 * ---------------------------------------------------------------------------
 *
 * `prisma migrate dev` cannot be used here, and `npm run db:migrate` is an alias
 * for it. It reports drift and offers to reset both the `auth` and `public`
 * schemas of the real database. The drift is not real: `tables.external` above
 * excludes Supabase's auth *tables* from diffing, but there is no equivalent for
 * *enum types*, so Supabase's own aal_level, factor_type, one_time_token_type
 * and friends always look like enums the migration history did not create.
 *
 * Author the SQL with `migrate diff` instead, which only reads. Steps:
 *
 *   1. Edit prisma/schema.prisma.
 *
 *   2. Make sure a local Postgres is running and holds an empty database for
 *      Prisma to replay migration history into. Postgres.app on port 5432:
 *
 *        createdb -h 127.0.0.1 -p 5432 mls_lms_shadow
 *        export SHADOW_DATABASE_URL="postgresql://$USER@127.0.0.1:5432/mls_lms_shadow"
 *
 *   3. Generate the SQL. This replays every existing migration into the shadow
 *      database and diffs the result against the schema, so a migration that
 *      cannot replay is caught here rather than against the real database:
 *
 *        mkdir -p "prisma/migrations/$(date -u +%Y%m%d%H%M%S)_<name>"
 *        npx prisma migrate diff --from-migrations prisma/migrations \
 *          --to-schema prisma/schema.prisma --script > <that dir>/migration.sql
 *
 *   4. Append any hand-written SQL the schema cannot express. For a new table
 *      that is always the privilege block — REVOKE ALL FROM anon, authenticated
 *      plus ENABLE ROW LEVEL SECURITY. Copy it from an existing migration.
 *
 *   5. Confirm nothing is left over. This must print "No difference detected":
 *
 *        npx prisma migrate diff --from-migrations prisma/migrations \
 *          --to-schema prisma/schema.prisma
 *
 *   6. Apply it, then regenerate the client:
 *
 *        npx prisma migrate deploy && npx prisma generate
 *
 * If step 3 fails with P3006 and an error about something missing in the `auth`
 * schema, the shadow database stub in `initShadowDb` above needs that object
 * added. The real database is fine; the stub is incomplete.
 */
