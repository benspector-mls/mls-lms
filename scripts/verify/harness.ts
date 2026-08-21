/**
 * What every `verify:` script is made of.
 *
 * These scripts are not a test suite and are not trying to be one. Each is a narrative about a
 * subsystem, readable top to bottom, and several are written against a real sandbox, a real
 * repository, or live rows — which is exactly what a unit test cannot do and why they stay.
 * What they were not is fourteen different programs: `check` was copied into all fourteen,
 * `refusal` into six, `inOwnTransaction` into two, and the dotenv preamble into twenty-one.
 *
 * Two lessons from writing them are built in here rather than left to be remembered.
 *
 * **A check that could not run must not report a pass.** `skip` records the reason and makes the
 * run exit non-zero, because a run that checked nothing is not a run that succeeded. Every script
 * that reports a skip fails, and says so in words.
 *
 * **A fixture selected by a proxy for the property it needs will eventually select the wrong
 * one.** "An instructor who is not the one this script acts as" is not "an instructor who does
 * not teach this course", and the wrong one passes by luck rather than failing. Nothing here can
 * enforce that; it is written down because the next script is where it will happen again.
 */
import { config as loadEnv } from "dotenv";

import type { Db, Tx } from "../../lib/prisma";

/**
 * `.env.local` first, then `.env`.
 *
 * dotenv does not overwrite a variable that is already set, so the order is the precedence: a
 * developer's own `.env.local` wins over the checked-in defaults. Quiet, because a banner above
 * every run is noise in a script whose output is read line by line.
 */
export function loadEnvironment(): void {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ quiet: true });
}

/**
 * The counters and the four things a script does with them.
 *
 * A factory rather than module-level state, because two scripts imported into one process
 * would otherwise share a failure count and each report the other's problems.
 */
export function createChecker() {
  let failures = 0;
  const skips: string[] = [];

  /**
   * Deep equality, compared through `JSON.stringify`.
   *
   * The comparison most of these scripts want, because what they assert is the shape of a
   * procedure's return value. Stringify rather than a recursive walk: key order is stable for
   * objects built the same way, and a difference in key order is a difference worth seeing.
   */
  const check = (label: string, actual: unknown, expected: unknown): void => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
      failures += 1;
      console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
    } else {
      console.log(`ok   ${label}`);
    }
  };

  /**
   * An assertion that is already a boolean, with an optional detail.
   *
   * A genuinely different tool from `check` rather than drift, which is why it has its own name.
   * The scripts that reach for it are asking whether something holds — a permission is granted,
   * a URL points where it should — where the interesting text is a description rather than the
   * value that was wrong.
   */
  const checkThat = (label: string, pass: boolean, detail = ""): void => {
    if (pass) {
      console.log(`ok   ${label}${detail && `  (${detail})`}`);
    } else {
      failures += 1;
      console.log(`FAIL ${label}${detail && `\n  ${detail}`}`);
    }
  };

  /**
   * A group of checks that could not be attempted, and why.
   *
   * Counted separately from a failure because it is a different fact — nothing is known to be
   * broken — and it still exits non-zero, because the alternative is a green run that measured
   * less than it claimed. These scripts depend on seeded data, and the day that data changes
   * shape (a student removed in the running application was enough) a whole group can stop
   * running while the output goes on saying everything is fine.
   *
   * Takes the reason alone, because that is what a reader needs and what every call site
   * already passes.
   */
  const skip = (reason: string): void => {
    skips.push(reason);
    console.log(`\nSKIPPED — ${reason}`);
  };

  /**
   * The summary and the exit code.
   *
   * Sets `process.exitCode` rather than calling `process.exit`, so a caller can still close a
   * database connection afterwards — `process.exit` would cut the pool off mid-flush.
   */
  const finish = (): void => {
    if (failures > 0) {
      console.log(`\n${failures} FAILED`);
    } else if (skips.length === 0) {
      console.log("\nAll checks passed.");
    } else {
      console.log(
        `\n${skips.length} group(s) did not run. Nothing failed, but this is not a pass.`,
      );
    }

    if (failures > 0 || skips.length > 0) process.exitCode = 1;
  };

  return {
    check,
    checkThat,
    skip,
    finish,
    get failures() {
      return failures;
    },
    get skipped() {
      return skips.length;
    },
  };
}

/**
 * What a call refused with, as a string to compare against.
 *
 * Returns the tRPC error code where there is one and the error's name otherwise, so a check
 * reads `check("a student cannot rename a module", await refusal(...), "FORBIDDEN")`. The
 * literal `"accepted"` is what comes back when the call did *not* refuse, which is what makes a
 * missing guard a visible failure rather than an unhandled rejection.
 */
export async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

/**
 * Runs one check inside a transaction of its own, then rolls it back.
 *
 * **Required for anything that provokes a database constraint**, as opposed to a refusal the
 * procedure makes before touching the database. A failed statement aborts the whole Postgres
 * transaction — every later statement returns `25P02: current transaction is aborted` — so a
 * duplicate-name check cannot share one with the checks that follow it. Found by doing it wrong:
 * the first duplicate refused as expected and took eleven unrelated checks down with it.
 */
export async function inOwnTransaction(
  db: Db,
  work: (tx: Tx) => Promise<void>,
  /**
   * How long the transaction may take, where Prisma's five-second default is not enough.
   *
   * Most callers provoke one constraint and need nothing. A group that drives whole procedures
   * does, and the failure without it is the misleading kind: the transaction expires and every
   * check after it reports `INTERNAL_SERVER_ERROR` from whatever statement happened to be in
   * flight, which looks like several broken guards rather than one slow block. The scripts that
   * hand `db.$transaction` their own options were already passing a generous one for this reason.
   */
  options?: { timeout?: number },
): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await work(tx);
      throw new Error("ROLLBACK");
    }, options);
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }
}
