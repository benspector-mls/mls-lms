/**
 * The General Coding Framework: what the two kinds are called, what counts as reaching the bar,
 * and how a score is written down.
 *
 * The GCF is administered by CodeSignal, outside this application. A fellow sits a proctored one
 * whose result is shared with employers, and practises against mocks beforehand. It is not
 * coursework — there is no assignment behind a score and nothing was handed in — which is why it
 * lives here rather than anywhere near `lib/gradebook`.
 *
 * **Browser-safe and importing nothing but the generated enum**, in the manner of
 * `lib/course-units.ts`: the import preview, the gradebook's fifth tab, and a fellow's own page
 * all read this, and two of the three run in the browser.
 */

import { dateColumnFor, schoolDayFromColumn, type SchoolDay } from "./school-time";

import type { GcfKind } from "./generated/prisma/enums";

export type { GcfKind };

/**
 * The day an attempt happened, however it arrives, written as a person would say it.
 *
 * **Formatted in UTC, and that is not an oversight.** `takenOn` is a `@db.Date`, which Prisma
 * hands back as UTC midnight of a civil date — so formatting it in Brooklyn time renders the
 * *previous* day for every attempt in the system. The same trap `lib/school-time.ts` was written
 * for, which is why the two dangerous conversions come from there rather than being written again
 * here.
 *
 * Takes either the `Date` a query returned or the `YYYY-MM-DD` string a parsed export carries, so
 * the import preview and the gradebook show one day the same way.
 */
export function formatTakenOn(takenOn: Date | string): string {
  const day = (
    typeof takenOn === "string" ? takenOn.slice(0, 10) : schoolDayFromColumn(takenOn)
  ) as SchoolDay;

  return dateColumnFor(day).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** The two kinds, in the order screens present them: the real one first. */
export const GCF_KINDS = ["PROCTORED", "MOCK"] as const satisfies readonly GcfKind[];

export type GcfKindMeta = {
  /** What it is called as a column heading or a section title. Title case. */
  label: string;
  /** One of them, for a sentence. Sentence case. */
  noun: string;
  /** What the number means, in one line, shown where the score is. */
  blurb: string;
};

/**
 * `satisfies` rather than an annotation, so a kind added to the enum and forgotten here is a
 * compile error — the whole point of the two attempt in one file.
 */
export const GCF_KIND_META = {
  PROCTORED: {
    label: "Proctored GCF",
    noun: "proctored GCF",
    blurb:
      "The real assessment, sat under proctoring. A calibrated score from 200 to 600 that blends " +
      "correctness, speed, and question weight — and the figure shared with employers.",
  },
  MOCK: {
    label: "Mock GCF",
    noun: "mock GCF",
    blurb:
      "A practice attempt. Raw test-case correctness at 300 points a task, before any penalty or " +
      "speed scaling, so it is a different quantity from the proctored score rather than a " +
      "smaller one.",
  },
} satisfies Record<GcfKind, GcfKindMeta>;

/**
 * The score that counts as reaching the bar, per kind.
 *
 * **Program-wide rather than per cohort**, because it is a Marcy standard rather than something a
 * cohort sets. A constant rather than a column for the same reason: a per-course setting would
 * let two matriculations disagree about what a good GCF is, which is the opposite of what a standard is
 * for.
 *
 * 389 on the proctored 200–600 scale, and 600 on a mock's 1200. Both discriminate against real
 * results rather than sorting everybody into one bucket — in a term's export, 8 of 13 proctored
 * attempts reach 389 and 35 of 61 mock attempts reach 600.
 */
export const GCF_TARGET = {
  PROCTORED: 389,
  MOCK: 600,
} as const satisfies Record<GcfKind, number>;

/**
 * The scale a proctored score sits on.
 *
 * Here rather than on the row because CodeSignal's export reports no maximum for a proctored
 * attempt — the band is a property of the assessment rather than data in the file. A mock carries
 * its own `scorePossible`, which genuinely varies: 300 points a task over one, three, four, or
 * six of them.
 */
export const PROCTORED_SCALE = { min: 200, max: 600 } as const;

/** The parts of an attempt these read. Structural, so a test can build one in a line. */
export type ScoredAttempt = {
  kind: GcfKind;
  score: number;
  scorePossible: number | null;
};

/** Whether an attempt reached the bar for its kind. */
export function reachedTarget(attempt: ScoredAttempt): boolean {
  return attempt.score >= GCF_TARGET[attempt.kind];
}

/**
 * The score as it is written: `"512/600"` for a proctored attempt, `"840/1200"` for a mock.
 *
 * **Both carry a denominator, and the proctored one is supplied here rather than stored.** The
 * export reports no maximum for a proctored attempt, so `scorePossible` on those rows is null —
 * which is the honest record of what CodeSignal said. The 600 comes from `PROCTORED_SCALE`, which
 * is knowledge about the assessment, and it is applied at the point of display so the row keeps
 * saying what arrived.
 *
 * This was a bare `"512"` at first, on the reasoning that a proctored 200 is the *floor* of the
 * scale rather than zero — so `200/600` reads as a third of the marks when it is the bottom of the
 * range. That is still true, and it is why every screen showing proctored scores also says the
 * scale runs from 200. But two columns of scores where one has a denominator and the other does
 * not invites a worse misreading than the one it avoids: it makes the numbers look like different
 * *kinds* of thing rather than the same kind on different scales.
 *
 * **A percentage would still be wrong**, and none should be added. `(512 - 200) / 400` is the
 * honest fraction and nobody would recognise it; `512 / 600` is the one a reader would compute
 * from this label, and it overstates the bottom of the range.
 */
export function gcfScoreLabel(attempt: ScoredAttempt): string {
  const possible =
    attempt.scorePossible ?? (attempt.kind === "PROCTORED" ? PROCTORED_SCALE.max : null);

  return possible == null ? String(attempt.score) : `${attempt.score}/${possible}`;
}

/**
 * The one maximum every attempt of a kind shares, or null when they do not share one.
 *
 * **What lets a heading carry the scale so the cells beneath it do not have to.** "Proctored GCF
 * (out of 600)" said once above a column beats `/600` repeated down forty rows, and the scores
 * stay comparable at a glance because the reader has been told the scale rather than reminded of
 * it each time.
 *
 * Null is the case that makes this worth computing rather than assuming. A mock is 300 points a
 * task over however many tasks it had, so a real export carries 300, 900, 1200, and 1800 in the
 * same column — and a heading reading "out of 1200" above a column holding a 240/300 would be
 * flatly wrong. Where they differ, the caller falls back to writing the denominator on each cell.
 *
 * A proctored attempt always shares one: the export reports no maximum, so every row is null and
 * the scale is `PROCTORED_SCALE.max`.
 */
export function sharedMaximum(attempts: readonly ScoredAttempt[], kind: GcfKind): number | null {
  if (kind === "PROCTORED") return PROCTORED_SCALE.max;

  const seen = new Set(ofKind(attempts, kind).map((attempt) => attempt.scorePossible));
  // Nothing to contradict a heading when there is nothing there; one value is that value.
  if (seen.size === 0) return null;
  if (seen.size > 1) return null;

  return [...seen][0] ?? null;
}

/**
 * The target as it reads beside a column of scores: `"389"`, `"600"`.
 *
 * Bare, for the same reason the scores under a heading are. The heading names the scale once —
 * "Proctored GCF (out of 600)" — and a target written `389/600` beneath it would say the same
 * denominator a third time on the same screen.
 */
export function targetLabel(kind: GcfKind): string {
  return String(GCF_TARGET[kind]);
}

/** The scale a heading names: `"out of 600"`, or null where the attempts do not share one. */
export function scaleLabel(attempts: readonly ScoredAttempt[], kind: GcfKind): string | null {
  const maximum = sharedMaximum(attempts, kind);
  return maximum === null ? null : `out of ${maximum}`;
}

/** The parts of an attempt the orderings read. */
export type OrderedAttempt = ScoredAttempt & { takenOn: Date | string };

/** Only the attempts of one kind, since the two scales are never mixed. */
export function ofKind<A extends { kind: GcfKind }>(attempts: readonly A[], kind: GcfKind): A[] {
  return attempts.filter((attempt) => attempt.kind === kind);
}

/**
 * The highest score of a kind, or null where there is none.
 *
 * Ties break on the *earlier* date, so "best" names the first time somebody reached their high
 * point rather than the most recent time they matched it. That is the reading that makes best and
 * latest worth showing side by side: two dates that differ say the peak is behind them.
 */
export function bestOf<A extends OrderedAttempt>(attempts: readonly A[], kind: GcfKind): A | null {
  return ofKind(attempts, kind).reduce<A | null>((best, attempt) => {
    if (best === null) return attempt;
    if (attempt.score !== best.score) return attempt.score > best.score ? attempt : best;
    return new Date(attempt.takenOn) < new Date(best.takenOn) ? attempt : best;
  }, null);
}

/** The most recent attempt of a kind, or null. Ties break on the higher score. */
export function latestOf<A extends OrderedAttempt>(
  attempts: readonly A[],
  kind: GcfKind,
): A | null {
  return ofKind(attempts, kind).reduce<A | null>((latest, attempt) => {
    if (latest === null) return attempt;
    const a = new Date(attempt.takenOn).getTime();
    const b = new Date(latest.takenOn).getTime();
    if (a !== b) return a > b ? attempt : latest;
    return attempt.score > latest.score ? attempt : latest;
  }, null);
}

/**
 * Newest first, which is the order every screen lists attempts in.
 *
 * The most recent attempt is the one a reader wants first — it is what a fellow's standing is
 * now — and the trail behind it is context. Ties break on the higher score so the order is total
 * and two renders agree.
 */
export function sortByTakenOn<A extends OrderedAttempt>(attempts: readonly A[]): A[] {
  return [...attempts].sort((a, b) => {
    const diff = new Date(b.takenOn).getTime() - new Date(a.takenOn).getTime();
    return diff !== 0 ? diff : b.score - a.score;
  });
}

/** What a fellow's standing on one kind is, which is what the gradebook's row shows. */
/** How many recent attempts a summary shows before it stops being scannable. */
export const RECENT_SHOWN = 3;

/**
 * The most recent few attempts of a kind, newest first.
 *
 * **Fewer than asked for is a real answer, not a shortfall.** A fellow who has attempted the GCF
 * twice has two results, and padding to three or refusing to show anything until there are three
 * would both misrepresent that. An empty array means they have not attempted it, which is the one
 * state a reader most needs to tell apart from a low score.
 *
 * Three because it is the shortest run that shows a *direction*. One score says where somebody
 * stands, two say whether the last move was up or down, and three distinguish steady improvement
 * from a bounce. Past three the cell stops being readable at a glance, which is what a summary
 * column is for.
 */
export function recentOf<A extends OrderedAttempt>(
  attempts: readonly A[],
  kind: GcfKind,
  count: number = RECENT_SHOWN,
): A[] {
  return sortByTakenOn(ofKind(attempts, kind)).slice(0, count);
}

export type GcfStanding<A extends OrderedAttempt> = {
  attempts: number;
  best: A | null;
  latest: A | null;
  /** The most recent few, newest first. Empty when the GCF has not been attempted. */
  recent: A[];
  /** Whether the best attempt reached the bar. */
  reached: boolean;
};

export function standingFor<A extends OrderedAttempt>(
  attempts: readonly A[],
  kind: GcfKind,
): GcfStanding<A> {
  const own = ofKind(attempts, kind);
  const best = bestOf(own, kind);

  return {
    attempts: own.length,
    best,
    latest: latestOf(own, kind),
    recent: recentOf(own, kind),
    /*
      Measured against the best rather than the latest. Reaching the bar is not something a
      later, weaker attempt takes away — a fellow who scored 420 in March and 380 in May has
      reached 389, and telling them otherwise would make practising afterwards a risk.
    */
    reached: best !== null && reachedTarget(best),
  };
}
