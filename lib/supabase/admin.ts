import "server-only";

/**
 * Creating and deleting Supabase auth users, which nothing else in this application does.
 *
 * Identity is Supabase's: `Profile.id` is a foreign key onto `auth.users.id`, so a profile cannot
 * exist without an auth user, and the on-signup trigger is what normally creates the pair. Test
 * students are the one identity this application makes rather than receives, which is the only
 * reason these two calls exist. Nothing else should use them — a person's account is created by
 * that person signing up.
 *
 * **Plain `fetch` against the auth REST endpoints rather than `createClient`**, for the reason
 * `lib/uploads/storage.ts` imports `StorageClient` alone: `createClient` eagerly constructs a
 * realtime client, which needs a global `WebSocket` and therefore throws outright on Node 20.
 * Nothing here wants realtime, a Postgres connection, or a session — Prisma owns the database and
 * these are two HTTP calls — so speaking to the endpoint directly avoids a dependency on the
 * runtime's version. It is also less code than the alternative.
 *
 * The key is read per call rather than at module scope, matching `storageClient()`: on Fluid
 * Compute an instance is reused across concurrent requests, and configuration cached at module
 * scope is shared state between them.
 *
 * **The service role key bypasses row level security and every policy.** Both functions therefore
 * take an authorized context and refuse a caller who is not an ADMIN, rather than documenting that
 * rule and trusting each call site to have honoured it.
 *
 * What that check is and is not worth stating plainly: server code can fabricate an object with
 * `role: "ADMIN"` on it, so this stops a mistake and not an attacker. A mistake is the realistic
 * failure — a future procedure reaching for `createAuthUser` because it needs an account, from a
 * builder that admits instructors — and the rule stops being something a reader has to already
 * know. The guarantee against an attacker is upstream, in the procedure builders in
 * `trpc/init.ts`, and this does not replace it.
 */

/** A failure from the auth admin API, worded for the admin who hit it. */
export class AuthAdminError extends Error {
  constructor(
    message: string,
    /** The HTTP status, so a caller can tell a duplicate address from a broken deployment. */
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthAdminError";
  }
}

/** The status Supabase answers with when the address is already taken. */
export const EMAIL_TAKEN_STATUS = 422;

/**
 * Just enough of a caller to check. Deliberately not `AuthedCtx`: neither function here touches
 * the database, and asking for a client they do not use would be asking a caller to prove
 * something unrelated to what is being decided.
 */
type ServiceRoleCaller = { profile: { role: string } };

/**
 * Refuses anybody but an admin, before the key is read.
 *
 * Ordered that way on purpose — a non-admin caller never reaches the branch that pulls the key
 * out of the environment, so the failure is about authorization rather than about configuration.
 */
function assertMayUseServiceRole(caller: ServiceRoleCaller, what: string): void {
  if (caller.profile.role !== "ADMIN") {
    throw new AuthAdminError(
      `Only an admin may ${what}. This uses the Supabase service role key, which bypasses ` +
        `row level security and every policy on every table.`,
      403,
    );
  }
}

function adminConfig(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new AuthAdminError(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required to create or " +
        "delete a test student.",
      0,
    );
  }

  return { url, key };
}

/**
 * Creates an auth user, and with it — through the `on_auth_user_created` trigger — its profile row.
 *
 * `email_confirm: true` because there is no mailbox to confirm from: the address is on a reserved
 * domain, deliberately. No password is set, so the account cannot be signed into.
 *
 * `display_name` goes in `user_metadata` because that is where the trigger looks for it, so the
 * profile arrives already named rather than needing a second write to fix.
 *
 * A taken address returns an `AuthAdminError` with status 422 rather than something generic,
 * because that case is not an error at the caller: it means another admin took the number first,
 * and the answer is to try the next one.
 */
export async function createAuthUser(
  caller: ServiceRoleCaller,
  params: {
    email: string;
    displayName: string;
  },
): Promise<{ id: string }> {
  assertMayUseServiceRole(caller, "create a test student");

  const { url, key } = adminConfig();

  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      email_confirm: true,
      user_metadata: { display_name: params.displayName },
    }),
  });

  if (!response.ok) {
    throw new AuthAdminError(
      `Supabase refused to create the auth user for ${params.email}: ` +
        `${response.status} ${await response.text()}`,
      response.status,
    );
  }

  const body: unknown = await response.json();
  const id = (body as { id?: unknown }).id;

  if (typeof id !== "string") {
    throw new AuthAdminError(
      `Supabase created the auth user for ${params.email} but returned no id.`,
      response.status,
    );
  }

  return { id };
}

/**
 * Deletes an auth user, and with it everything that cascades from its profile — enrollments,
 * submissions, test runs, and grading drafts.
 *
 * A 404 is success: the point of calling this is that the user should not exist afterwards, and
 * one already gone satisfies that. It is reached in the ordinary way when creating a test student
 * fails partway and the cleanup runs twice.
 */
export async function deleteAuthUser(caller: ServiceRoleCaller, id: string): Promise<void> {
  assertMayUseServiceRole(caller, "delete a test student");

  const { url, key } = adminConfig();

  const response = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });

  if (!response.ok && response.status !== 404) {
    throw new AuthAdminError(
      `Supabase refused to delete the auth user ${id}: ${response.status} ${await response.text()}`,
      response.status,
    );
  }
}
