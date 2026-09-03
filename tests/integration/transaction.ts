/**
 * A transaction held open for a `describe`, and rolled back when it ends.
 *
 * `inOwnTransaction` in `scripts/verify/harness.ts` is the same idea shaped for a script: it takes
 * the whole group as a callback, runs it, and throws `ROLLBACK` to discard the work. A Jest group
 * cannot be a callback — its tests are registered first and run afterwards — so the transaction
 * has to be opened by `beforeAll`, left open across every test, and released by `afterAll`. That
 * is the whole of what this file adds.
 *
 * The mechanism is a promise the transaction body waits on. Prisma's interactive transaction takes
 * a callback and commits when it returns; so the callback hands its `tx` out, then waits, and
 * `afterAll` is what lets it finish. Throwing at the end is what discards the work — the same
 * sentinel the harness throws, caught by the same comparison.
 *
 * **The transaction is not isolation from the application.** Rows written inside it are invisible
 * to anything else, which is the point, but a caller built on `db` rather than on this `tx` reads
 * the committed database and will not see them. The scripts learned this the expensive way and it
 * is recorded here rather than left to be rediscovered: `verify:authoring` creates a real
 * submission outside its transaction, and deletes it in a `finally`, precisely because `getDraft`
 * is reached through a caller bound to `db`.
 */
import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/prisma";

/** What Prisma hands an interactive transaction's callback. */
export type Tx = Prisma.TransactionClient;

/**
 * Opens the transaction for the surrounding `describe` and returns a getter for it.
 *
 * A getter rather than the client itself, because `beforeAll` has not run at the moment the
 * `describe` body is evaluated — that is when tests are registered, not when they run. Every use
 * is therefore `tx()` inside a test body, where the transaction exists.
 *
 * @param timeout How long the whole group may take. The default is generous because the budget
 *   covers every test in the group rather than one query, and because the failure when it is too
 *   short is the misleading kind: the transaction expires and every check after it reports an
 *   internal error from whatever statement happened to be in flight, which reads as several broken
 *   procedures rather than as one slow group.
 *
 *   Two minutes rather than the one the scripts used, because a group now builds its own fixture
 *   instead of finding one. Against the local database that costs nothing — the whole suite runs in
 *   under two seconds — but against the development Supabase project every write is a network round
 *   trip, and the run that first exceeded this failed forty-one checks at once with nothing wrong
 *   in any of them.
 */
export function withRollback(timeout = 120_000): () => Tx {
  let tx: Tx | undefined;
  let release: (() => void) | undefined;
  /** The transaction's own promise, awaited in `afterAll` so a rollback failure is not unhandled. */
  let settled: Promise<void> | undefined;

  beforeAll(async () => {
    await new Promise<void>((open, failed) => {
      settled = db
        .$transaction(
          async (client) => {
            tx = client;
            open();
            await new Promise<void>((done) => {
              release = done;
            });
            throw new Error("ROLLBACK");
          },
          {
            timeout,
            /*
              How long to wait for a connection before giving up on starting at all, as opposed to
              `timeout`, which is how long the transaction may then run for.

              Prisma's default is two seconds and it is not enough here. A file holds one connection
              open for the length of a whole group, so the next group is waiting on the pool rather
              than on the database — and against Supabase's transaction pooler that wait exceeded
              two seconds often enough to fail an entire file, with `Unable to start a transaction
              in the given time` and nothing wrong in any of the checks.
            */
            maxWait: 30_000,
          },
        )
        .then(
          () => undefined,
          (err: unknown) => {
            if (err instanceof Error && err.message === "ROLLBACK") return;
            /*
              A transaction that failed before handing its client out has to reject the opening
              promise, or `beforeAll` waits for a client that is never coming and Jest reports a
              hook timeout instead of the connection error that caused it.
            */
            failed(err);
            throw err;
          },
        );
    });
  });

  afterAll(async () => {
    release?.();
    await settled?.catch(() => undefined);
  });

  return () => {
    if (!tx) {
      throw new Error(
        "The transaction is not open yet. `withRollback()` returns a getter, and it may only be " +
          "called inside a test or a hook — not in the body of the describe.",
      );
    }
    return tx;
  };
}

/**
 * Stops a group when the data it needs is not there.
 *
 * **A check that could not run must not report a pass**, which is the rule the harness implements
 * by making `skip` exit non-zero. Jest's own `it.skip` does the opposite — a skipped test is a
 * green run — so nothing here uses it. Throwing from `beforeAll` fails every test in the group,
 * which is the same loud outcome, and the message says which of the two things happened.
 *
 * The better answer, wherever a group can manage it, is to create the fixture inside the
 * transaction and never ask this question. Two scripts skip every group they have on a freshly
 * seeded database, and have therefore been measuring nothing at all.
 */
export function required<T>(what: string, fixture: T | null | undefined): T {
  if (fixture === null || fixture === undefined) {
    throw new Error(
      `NOTHING BROKEN, NOTHING MEASURED: this group needs ${what}, and the database has none. ` +
        "Every test below is failed rather than skipped, because a group that measured nothing " +
        "must not report a pass.",
    );
  }
  return fixture;
}
