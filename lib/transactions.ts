/**
 * Whether a write path opens its own transaction, or joins one it was handed.
 *
 * Several of the acts in this application — approving a draft, accepting an assignment, running
 * a suite — take a client to write through rather than reaching for the application's own. That
 * is what lets a check script drive the whole act inside a transaction it then rolls back, which
 * is the only way the parts that talk to GitHub can be exercised against real rows.
 *
 * Those callers then have to decide whether to open a transaction around their own writes, and
 * **the decision cannot be made by asking the client what it is.** A transaction client still
 * carries `$transaction` at runtime even though its type omits it, so calling it opens a *second*
 * transaction on a different connection — one that cannot see the rows the caller's own
 * transaction has written, and fails with "no record was found for an update" on a row that is
 * plainly there.
 *
 * So the decision is made by identity: a client that *is* the application's own is not a
 * transaction, whoever passed it. Asking merely whether a client was handed in is the mistake
 * this function exists to prevent, because the request path passes `ctx.db` — which in production
 * is the application's own client — so "was one handed in" answers yes on every request and the
 * writes never become atomic at all.
 *
 * Pure, generic, and its own module with no imports, so it can be tested without a database.
 */
export function opensOwnTransaction<T>(handedIn: T | undefined | null, appClient: T): boolean {
  return handedIn == null || handedIn === appClient;
}
