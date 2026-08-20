import { opensOwnTransaction } from "@/lib/transactions";

/**
 * Whether a write path opens its own transaction.
 *
 * Three branches, and the middle one is the whole reason this is a named function: the request
 * path hands in `ctx.db`, which in production *is* the application's own client, so a check for
 * "was a client handed in" answers yes on every request and the writes are never atomic.
 */
describe("opensOwnTransaction", () => {
  const appClient = { name: "the application's own client" };

  it("opens one when nothing was handed in", () => {
    expect(opensOwnTransaction(undefined, appClient)).toBe(true);
    expect(opensOwnTransaction(null, appClient)).toBe(true);
  });

  it("opens one when what was handed in is the application's own client", () => {
    // The case a presence check gets wrong. Every request reaches these acts through the router,
    // which passes its own `ctx.db` — the same object.
    expect(opensOwnTransaction(appClient, appClient)).toBe(true);
  });

  it("joins the caller's when a real transaction was handed in", () => {
    // Opening a second transaction here would be on a different connection, unable to see the
    // rows the caller's own transaction has written.
    const tx = { name: "a transaction" };
    expect(opensOwnTransaction(tx, appClient)).toBe(false);
  });

  it("compares identity rather than shape", () => {
    // A transaction client and the application's client look alike; only identity separates them.
    expect(opensOwnTransaction({ ...appClient }, appClient)).toBe(false);
  });
});
