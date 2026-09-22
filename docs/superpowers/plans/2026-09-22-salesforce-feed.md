# Salesforce Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One token-protected HTTP route that serves nine cursor-paged collections of records for Make.com to upsert into Salesforce, with no schema change.

**Architecture:** Pure modules decide everything from their arguments — how a cursor parses and a page is cut (`cursor.ts`), whether a bearer token matches (`token.ts`), and what each Salesforce record looks like given a row (`records.ts`). One server module runs the queries and holds the table of collections (`collections.ts`); one more turns an HTTP request into a response (`feed.ts`); the Next.js route file delegates to it. Seven collections read one table each through a Prisma `where` built from the cursor; two are computed in memory from small tables and walked with the same cursor semantics.

**Tech Stack:** Next.js route handler (`app/api/.../route.ts`), Prisma 7 against Postgres, Node `crypto`, Jest via `next/jest` for unit tests (`tests/lib/`), and the rolled-back-transaction integration suite (`tests/integration/`, `npm run test:integration`).

**Spec:** `docs/superpowers/specs/2026-09-22-salesforce-feed-design.md` — the plan argues from the spec; read both.

## Global Constraints

- **No schema change.** No migration, no new column, no new table. Every identifier is a primary key or a pair of them; every timestamp is an existing `updatedAt`.
- **Test students are excluded from every collection**: every query that reaches a profile filters `testStudentNumber: null`.
- **Identifiers:** a row's UUID where there is a row; `attendance:<programId>` for the synthetic class; `<courseId>:<enrollmentId>` for a registration; `<assignmentId>:<enrollmentId>` for an assignment submission.
- **Ordering:** every collection is ordered by `(updatedAt, externalId)` ascending. `limit` defaults to 200 and is capped at 500. `after` without `since` is a 400. An unknown collection is a 404, checked *after* the token.
- **Envelope:** `{ records, hasMore, cursor }`, `cursor` null when `hasMore` is false, `Cache-Control: no-store`.
- **Timestamps** serialise as ISO 8601 UTC (JSON's default for `Date`); the two civil dates go through `schoolDayFromColumn` as `YYYY-MM-DD`.
- **Refusals are terse plain text** — `401 Unauthorized`, `404 Not found`, `400 <one line>` — following `app/api/calendar/[token]/route.ts`.
- **Environment variable:** `SALESFORCE_FEED_TOKEN`. Unset means every request is refused.
- **Commits go straight to `main`**, one per task, and are not pushed. Subjects are sentences, as the repository's history is written. End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Comment density and voice match the surrounding code**: doc comments say why a thing is the way it is, and name the alternative that was not taken where that helps the next reader.
- **Prettier owns formatting.** Run `npm run format` before each commit; `npm run lint` and `npm run typecheck` must both be clean at the end of every task.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/integrations/salesforce/cursor.ts` | Parse `since`/`after`/`limit`; the `Positioned` shape every record has; cut a page and write the next cursor; the Prisma `where` for a table-backed walk and the in-memory walk for a computed one. Pure. |
| `lib/integrations/salesforce/token.ts` | `bearerTokenMatches`. Pure. |
| `lib/integrations/salesforce/records.ts` | The identifier builders, the status collapse, the assignment type, the point value rule, and one mapper per collection from a row shape to a record. Pure. |
| `lib/integrations/salesforce/collections.ts` | `COLLECTIONS`: the nine named functions from `(tx, query)` to a page. Server-only; the only module that runs queries. |
| `lib/integrations/salesforce/feed.ts` | `serveFeed(request, collection)`: token, 404, parse, run, envelope. Server-only. |
| `app/api/integrations/salesforce/[collection]/route.ts` | `GET` → `serveFeed`. |
| `tests/lib/integrations/salesforce/cursor.test.ts` | Unit tests for `cursor.ts`. |
| `tests/lib/integrations/salesforce/token.test.ts` | Unit tests for `token.ts`. |
| `tests/lib/integrations/salesforce/records.test.ts` | Unit tests for `records.ts`. |
| `tests/lib/integrations/salesforce/feed.test.ts` | Unit tests for the three refusals in `feed.ts`, which need no database. |
| `tests/integration/salesforce-feed.test.ts` | Every collection walked against the test database inside a rolled-back transaction. Grows by one `describe` per task from Task 5 on. |

The spec names two files, `route.ts` and `feed.ts`; this plan splits `feed.ts` along the repository's standing line between pure modules that decide something from their arguments (unit-tested on every save) and server modules that touch the database (integration-tested on purpose). Task 10 updates the spec's file list to match.

---

### Task 1: Cursor, position, and page

**Files:**
- Create: `lib/integrations/salesforce/cursor.ts`
- Test: `tests/lib/integrations/salesforce/cursor.test.ts`

**Interfaces:**
- Produces:
  - `type Cursor = { since: Date; after: string } | null`
  - `type FeedQuery = { cursor: Cursor; limit: number }`
  - `type FeedQueryError = { error: string }`
  - `const DEFAULT_LIMIT = 200`, `const MAX_LIMIT = 500`
  - `parseFeedQuery(params: URLSearchParams): FeedQuery | FeedQueryError`
  - `isFeedQueryError(value): value is FeedQueryError`
  - `type Positioned = { externalId: string; updatedAt: Date }`
  - `type Page<R extends Positioned> = { records: R[]; hasMore: boolean; cursor: { since: string; after: string } | null }`
  - `isAfter(item: Positioned, cursor: Cursor): boolean`
  - `byPosition(a: Positioned, b: Positioned): number`
  - `pageOf<R extends Positioned>(candidates: R[], limit: number): Page<R>` — `candidates` is already ordered and holds at most `limit + 1` records
  - `walk<R extends Positioned>(items: R[], query: FeedQuery): Page<R>` — filter, sort, cut
  - `cursorWhere(cursor: Cursor)` — the Prisma `where` fragment keyed on `updatedAt` and `id`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/integrations/salesforce/cursor.test.ts`:

```ts
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  byPosition,
  cursorWhere,
  isAfter,
  isFeedQueryError,
  pageOf,
  parseFeedQuery,
  walk,
  type Positioned,
} from "@/lib/integrations/salesforce/cursor";

/**
 * Where a walk stands, and how a page is cut from it.
 *
 * The property worth guarding is that a walk returns every record exactly once and then stops.
 * Both halves fail quietly: a cursor that lands *on* the last record rather than after it returns
 * it at the top of every page, and a walk of the same size as its page never says `hasMore: false`.
 */

const T0 = new Date("2026-09-22T14:00:00.000Z");
const T1 = new Date("2026-09-22T14:00:01.000Z");

function at(externalId: string, updatedAt: Date): Positioned {
  return { externalId, updatedAt };
}

describe("parseFeedQuery", () => {
  it("has no cursor and the default limit when nothing is sent", () => {
    expect(parseFeedQuery(new URLSearchParams())).toEqual({ cursor: null, limit: DEFAULT_LIMIT });
  });

  it("reads since alone as a position at the start of that instant", () => {
    const query = parseFeedQuery(new URLSearchParams({ since: T0.toISOString() }));
    expect(query).toEqual({ cursor: { since: T0, after: "" }, limit: DEFAULT_LIMIT });
  });

  it("reads since and after together", () => {
    const query = parseFeedQuery(new URLSearchParams({ since: T0.toISOString(), after: "b" }));
    expect(query).toEqual({ cursor: { since: T0, after: "b" }, limit: DEFAULT_LIMIT });
  });

  it("refuses after without since", () => {
    const query = parseFeedQuery(new URLSearchParams({ after: "b" }));
    expect(isFeedQueryError(query)).toBe(true);
  });

  it("refuses a since that is not an instant", () => {
    expect(isFeedQueryError(parseFeedQuery(new URLSearchParams({ since: "yesterday" })))).toBe(true);
  });

  it("caps limit and refuses a limit that is not a positive integer", () => {
    expect(parseFeedQuery(new URLSearchParams({ limit: "5" }))).toEqual({ cursor: null, limit: 5 });
    expect(parseFeedQuery(new URLSearchParams({ limit: "9999" }))).toEqual({
      cursor: null,
      limit: MAX_LIMIT,
    });
    expect(isFeedQueryError(parseFeedQuery(new URLSearchParams({ limit: "0" })))).toBe(true);
    expect(isFeedQueryError(parseFeedQuery(new URLSearchParams({ limit: "2.5" })))).toBe(true);
    expect(isFeedQueryError(parseFeedQuery(new URLSearchParams({ limit: "many" })))).toBe(true);
  });
});

describe("isAfter", () => {
  it("admits everything when there is no cursor", () => {
    expect(isAfter(at("a", T0), null)).toBe(true);
  });

  it("admits a later instant, and at the same instant only a greater identifier", () => {
    const cursor = { since: T0, after: "b" };
    expect(isAfter(at("a", T1), cursor)).toBe(true);
    expect(isAfter(at("c", T0), cursor)).toBe(true);
    expect(isAfter(at("b", T0), cursor)).toBe(false);
    expect(isAfter(at("a", T0), cursor)).toBe(false);
  });

  it("with an empty after, admits every record at the instant itself", () => {
    expect(isAfter(at("a", T0), { since: T0, after: "" })).toBe(true);
  });
});

describe("byPosition", () => {
  it("orders by instant, then identifier", () => {
    const sorted = [at("b", T1), at("c", T0), at("a", T1), at("a", T0)].sort(byPosition);
    expect(sorted.map((item) => `${item.externalId}@${item.updatedAt.toISOString()}`)).toEqual([
      `a@${T0.toISOString()}`,
      `c@${T0.toISOString()}`,
      `a@${T1.toISOString()}`,
      `b@${T1.toISOString()}`,
    ]);
  });
});

describe("pageOf", () => {
  it("says hasMore and writes the cursor after the last record kept when one extra arrived", () => {
    const page = pageOf([at("a", T0), at("b", T0), at("c", T1)], 2);
    expect(page.records.map((item) => item.externalId)).toEqual(["a", "b"]);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toEqual({ since: T0.toISOString(), after: "b" });
  });

  it("says no more and no cursor when everything fit", () => {
    const page = pageOf([at("a", T0), at("b", T0)], 2);
    expect(page.records).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(page.cursor).toBeNull();
  });

  it("is empty, finished, and cursorless for nothing", () => {
    expect(pageOf([], 2)).toEqual({ records: [], hasMore: false, cursor: null });
  });
});

describe("walk", () => {
  const items = [at("b", T1), at("c", T0), at("a", T1), at("a", T0), at("b", T0)];

  it("returns every item exactly once across pages, then stops", () => {
    const seen: string[] = [];
    let cursor: { since: Date; after: string } | null = null;
    for (let pages = 0; pages < 10; pages += 1) {
      const page = walk(items, { cursor, limit: 2 });
      seen.push(...page.records.map((item) => `${item.externalId}@${item.updatedAt.getTime()}`));
      if (!page.hasMore) break;
      cursor = { since: new Date(page.cursor!.since), after: page.cursor!.after };
    }
    expect(seen).toEqual([
      `a@${T0.getTime()}`,
      `b@${T0.getTime()}`,
      `c@${T0.getTime()}`,
      `a@${T1.getTime()}`,
      `b@${T1.getTime()}`,
    ]);
  });
});

describe("cursorWhere", () => {
  it("is empty without a cursor", () => {
    expect(cursorWhere(null)).toEqual({});
  });

  it("asks for a later instant, or the same instant and a greater id", () => {
    expect(cursorWhere({ since: T0, after: "b" })).toEqual({
      OR: [{ updatedAt: { gt: T0 } }, { updatedAt: T0, id: { gt: "b" } }],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/integrations/salesforce/cursor.test.ts`
Expected: FAIL — `Cannot find module '@/lib/integrations/salesforce/cursor'`.

- [ ] **Step 3: Write the implementation**

Create `lib/integrations/salesforce/cursor.ts`:

```ts
/**
 * Where a walk over a collection stands, and how a page is cut from it.
 *
 * Every collection the Salesforce feed serves is ordered by `(updatedAt, externalId)` ascending,
 * and a cursor is the last position a caller saw. Nothing here touches the database. A collection
 * read from one table turns the cursor into a Prisma `where` with `cursorWhere`; a collection
 * computed from several filters and sorts in memory with `walk`; both hand an ordered list to
 * `pageOf`, which cuts the page and says where the next one starts.
 *
 * **Why a position and not a timestamp alone.** A bulk update writes one `updatedAt` to many rows
 * at once. A cursor holding only the instant would either skip the rest of that group or return it
 * on every page; the identifier is the tiebreaker that makes the order total.
 *
 * **`since` round-trips at millisecond precision, and that is relied on.** The cursor crosses the
 * wire as an ISO 8601 string, which a JavaScript `Date` holds to the millisecond. Every `updatedAt`
 * these collections read is written by Prisma's `@updatedAt` — a JavaScript `Date`, so also to the
 * millisecond — and compares equal to its own cursor. A value written by the database's `now()`
 * would carry microseconds, compare *greater* than the truncated cursor, and sit at the top of
 * every page forever. No collection reads such a column; the integration suite's walk at `limit=1`
 * is what would notice if one ever did.
 */

export type Cursor = { since: Date; after: string } | null;

export type FeedQuery = { cursor: Cursor; limit: number };

/** One line, for the 400. Terse on purpose — see `feed.ts` for why refusals say little. */
export type FeedQueryError = { error: string };

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;

/**
 * `since` alone is a position at the very start of that instant: `after` becomes the empty
 * string, which every identifier sorts after, so records *at* the instant are included. `after`
 * alone is refused, because a tiebreaker with nothing to break the tie against is a caller mistake
 * rather than a position — and a misconfigured scenario that silently re-walked the whole table on
 * every run is the failure worth refusing loudly.
 */
export function parseFeedQuery(params: URLSearchParams): FeedQuery | FeedQueryError {
  const since = params.get("since");
  const after = params.get("after");
  const limitParam = params.get("limit");

  if (after !== null && since === null) {
    return { error: "after needs since" };
  }

  let cursor: Cursor = null;
  if (since !== null) {
    const instant = new Date(since);
    if (Number.isNaN(instant.getTime())) return { error: "since must be an ISO 8601 instant" };
    cursor = { since: instant, after: after ?? "" };
  }

  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return { error: "limit must be a positive integer" };
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  return { cursor, limit };
}

export function isFeedQueryError(value: FeedQuery | FeedQueryError): value is FeedQueryError {
  return "error" in value;
}

/** What every record carries, so that a page can be cut from it and a cursor written after it. */
export type Positioned = { externalId: string; updatedAt: Date };

export type Page<R extends Positioned> = {
  records: R[];
  hasMore: boolean;
  /** The position to send next. Null when `hasMore` is false, so a caller has one thing to test. */
  cursor: { since: string; after: string } | null;
};

export function isAfter(item: Positioned, cursor: Cursor): boolean {
  if (cursor === null) return true;
  const at = item.updatedAt.getTime();
  const since = cursor.since.getTime();
  return at > since || (at === since && item.externalId > cursor.after);
}

export function byPosition(a: Positioned, b: Positioned): number {
  const byInstant = a.updatedAt.getTime() - b.updatedAt.getTime();
  if (byInstant !== 0) return byInstant;
  if (a.externalId < b.externalId) return -1;
  return a.externalId > b.externalId ? 1 : 0;
}

/**
 * Cut a page from an ordered list that holds at most `limit + 1` records.
 *
 * The extra record is how `hasMore` is known without a second count query: a caller asks for one
 * more than it will return, and its presence is the answer. The cursor is written after the last
 * record *kept*, never after the one discarded, or the next page would begin by skipping it.
 */
export function pageOf<R extends Positioned>(candidates: R[], limit: number): Page<R> {
  const hasMore = candidates.length > limit;
  const records = hasMore ? candidates.slice(0, limit) : candidates;
  const last = records[records.length - 1];

  return {
    records,
    hasMore,
    cursor: hasMore && last ? { since: last.updatedAt.toISOString(), after: last.externalId } : null,
  };
}

/**
 * The in-memory walk, for a collection computed from several tables rather than read from one.
 *
 * Filter, sort, and cut. The filter is what `cursorWhere` does in SQL for the other collections;
 * it runs here because the pair being walked has no row and therefore no `WHERE` to attach to.
 */
export function walk<R extends Positioned>(items: R[], query: FeedQuery): Page<R> {
  const ordered = items.filter((item) => isAfter(item, query.cursor)).sort(byPosition);
  return pageOf(ordered.slice(0, query.limit + 1), query.limit);
}

/**
 * The `where` a table-backed collection adds, keyed on the row's `id`.
 *
 * Empty without a cursor, so a caller can spread it into a `where` alongside its own conditions
 * either way. Typed as the literal shape rather than as any one model's `WhereInput`, because every
 * model here has `updatedAt` and `id` and this fragment fits all of them.
 */
export function cursorWhere(
  cursor: Cursor,
): { OR: [{ updatedAt: { gt: Date } }, { updatedAt: Date; id: { gt: string } }] } | Record<string, never> {
  if (cursor === null) return {};
  return {
    OR: [{ updatedAt: { gt: cursor.since } }, { updatedAt: cursor.since, id: { gt: cursor.after } }],
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/lib/integrations/salesforce/cursor.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Format, lint, typecheck, commit**

```bash
npm run format && npm run lint && npm run typecheck
git add lib/integrations/salesforce/cursor.ts tests/lib/integrations/salesforce/cursor.test.ts
git commit -F - <<'MSG'
A cursor is a position, and a page is cut after the last record kept

The Salesforce feed walks every collection by (updatedAt, externalId).
This is the pure half of that: parsing the position a caller sends, the
Prisma fragment for a table-backed walk, the in-memory walk for a computed
one, and the page cut that learns hasMore from one extra record rather
than a second query.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 2: The bearer token

**Files:**
- Create: `lib/integrations/salesforce/token.ts`
- Test: `tests/lib/integrations/salesforce/token.test.ts`

**Interfaces:**
- Produces: `bearerTokenMatches(authorization: string | null, expected: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/integrations/salesforce/token.test.ts`:

```ts
import { bearerTokenMatches } from "@/lib/integrations/salesforce/token";

/**
 * One caller, one secret. The cases worth writing down are the ones a naive comparison gets
 * wrong: a token of a different length must be refused *without throwing*, because
 * `timingSafeEqual` throws on unequal lengths and an exception here is a 500 that reads as an
 * outage rather than a refusal; and an empty expected value must refuse everything, because an
 * unset environment variable has to fail closed.
 */

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("bearerTokenMatches", () => {
  it("accepts the right token", () => {
    expect(bearerTokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("refuses a wrong token of the same length", () => {
    const wrong = `${TOKEN.slice(0, -1)}0`;
    expect(bearerTokenMatches(`Bearer ${wrong}`, TOKEN)).toBe(false);
  });

  it("refuses a token of a different length without throwing", () => {
    expect(() => bearerTokenMatches("Bearer short", TOKEN)).not.toThrow();
    expect(bearerTokenMatches("Bearer short", TOKEN)).toBe(false);
  });

  it("refuses a missing header, a bare token, and the wrong scheme", () => {
    expect(bearerTokenMatches(null, TOKEN)).toBe(false);
    expect(bearerTokenMatches(TOKEN, TOKEN)).toBe(false);
    expect(bearerTokenMatches(`Basic ${TOKEN}`, TOKEN)).toBe(false);
  });

  it("refuses everything when nothing is expected", () => {
    expect(bearerTokenMatches("Bearer ", "")).toBe(false);
    expect(bearerTokenMatches(`Bearer ${TOKEN}`, "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/integrations/salesforce/token.test.ts`
Expected: FAIL — `Cannot find module '@/lib/integrations/salesforce/token'`.

- [ ] **Step 3: Write the implementation**

Create `lib/integrations/salesforce/token.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";

const SCHEME = "Bearer ";

/**
 * Whether a request presented the feed's token.
 *
 * **Compared over digests, not over the strings.** `timingSafeEqual` refuses buffers of unequal
 * length by throwing, and a caller who sends a short token must be answered with a 401 rather than
 * a stack trace. Hashing both sides first makes the two buffers the same length whatever was sent,
 * and the comparison stays constant-time in the length that matters.
 *
 * **An empty expected value refuses everything.** That is what an unset `SALESFORCE_FEED_TOKEN`
 * becomes, and failing closed is the only acceptable way for a missing secret to fail. Without
 * this line, `Bearer ` with nothing after it would hash equal to an empty expected value and be
 * let in.
 */
export function bearerTokenMatches(authorization: string | null, expected: string): boolean {
  if (expected === "") return false;
  if (authorization === null || !authorization.startsWith(SCHEME)) return false;

  const presented = authorization.slice(SCHEME.length);
  return timingSafeEqual(digest(presented), digest(expected));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/lib/integrations/salesforce/token.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Format, lint, typecheck, commit**

```bash
npm run format && npm run lint && npm run typecheck
git add lib/integrations/salesforce/token.ts tests/lib/integrations/salesforce/token.test.ts
git commit -F - <<'MSG'
The feed's token is compared over digests, and an empty one refuses all

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 3: Identifiers, status, type, and point value

**Files:**
- Create: `lib/integrations/salesforce/records.ts`
- Test: `tests/lib/integrations/salesforce/records.test.ts`

**Interfaces:**
- Produces:
  - `attendanceClassId(programId: string): string` → `attendance:<programId>`
  - `registrationKey(courseId: string, enrollmentId: string): string` → `<courseId>:<enrollmentId>`
  - `submissionKey(assignmentId: string, enrollmentId: string): string` → `<assignmentId>:<enrollmentId>`
  - `later(a: Date, b: Date): Date`
  - `type FeedStatus = "notStarted" | "inProgress" | "submitted" | "graded"`
  - `collapseStatus(status: SubmissionStatus): FeedStatus`
  - `type AssignmentType = "assignment" | "project" | "assessment"`
  - `assignmentType(category: CourseUnitCategory): AssignmentType`
  - `pointValueOf(assignment: { kind: AssignmentKind; pointValue: number }): number`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/integrations/salesforce/records.test.ts`:

```ts
import {
  assignmentType,
  attendanceClassId,
  collapseStatus,
  later,
  pointValueOf,
  registrationKey,
  submissionKey,
} from "@/lib/integrations/salesforce/records";

/**
 * What a Salesforce record says, given a row.
 *
 * The rules under test here are the ones that decide identity and meaning across the whole
 * feed. An identifier built differently in two places is two Salesforce records for one thing;
 * a status collapsed differently is a report that disagrees with the gradebook.
 */

describe("identifiers", () => {
  it("names the synthetic attendance class by its program", () => {
    expect(attendanceClassId("p1")).toBe("attendance:p1");
  });

  it("names a registration by course then enrollment, and a submission by assignment then enrollment", () => {
    expect(registrationKey("c1", "e1")).toBe("c1:e1");
    expect(submissionKey("a1", "e1")).toBe("a1:e1");
  });
});

describe("later", () => {
  it("returns the later of two instants", () => {
    const earlier = new Date("2026-01-01T00:00:00Z");
    const afterwards = new Date("2026-01-02T00:00:00Z");
    expect(later(earlier, afterwards)).toBe(afterwards);
    expect(later(afterwards, earlier)).toBe(afterwards);
  });
});

describe("collapseStatus", () => {
  it("maps all eight statuses onto four", () => {
    expect(collapseStatus("NOT_STARTED")).toBe("notStarted");
    expect(collapseStatus("ACCEPTED")).toBe("inProgress");
    expect(collapseStatus("SUBMITTED")).toBe("submitted");
    expect(collapseStatus("RESUBMITTED")).toBe("submitted");
    expect(collapseStatus("DRAFT_READY")).toBe("submitted");
    expect(collapseStatus("GRADING_FAILED")).toBe("submitted");
    expect(collapseStatus("NEEDS_MANUAL_REVIEW")).toBe("submitted");
    expect(collapseStatus("GRADED")).toBe("graded");
  });
});

describe("assignmentType", () => {
  it("reads the unit's category", () => {
    expect(assignmentType("MODULE")).toBe("assignment");
    expect(assignmentType("PROJECT")).toBe("project");
    expect(assignmentType("ASSESSMENT")).toBe("assessment");
  });
});

describe("pointValueOf", () => {
  it("is one for a task and the column otherwise", () => {
    expect(pointValueOf({ kind: "TASK", pointValue: 40 })).toBe(1);
    expect(pointValueOf({ kind: "REPO", pointValue: 40 })).toBe(40);
    expect(pointValueOf({ kind: "GOOGLE_DRIVE", pointValue: 12 })).toBe(12);
    expect(pointValueOf({ kind: "SELF_DIRECTED", pointValue: 7 })).toBe(7);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/integrations/salesforce/records.test.ts`
Expected: FAIL — `Cannot find module '@/lib/integrations/salesforce/records'`.

- [ ] **Step 3: Write the implementation**

Create `lib/integrations/salesforce/records.ts`:

```ts
import type {
  AssignmentKind,
  CourseUnitCategory,
  SubmissionStatus,
} from "@/lib/generated/prisma/enums";

/**
 * What a Salesforce record says, given a row from here.
 *
 * Every function in this file decides something from its arguments and nothing else. The queries
 * that produce the rows are in `collections.ts`; this is where a row becomes the flat object Make
 * upserts, where the identifiers Salesforce keys on are spelled, and where the two vocabularies
 * that differ between the systems — submission status and assignment type — are translated.
 *
 * **The identifiers are spelled here and nowhere else.** A Class Registration and an unstarted
 * Assignment Submission have no row of their own, so their identifiers are pairs, and the pair
 * has to be built the same way by the collection that emits the record and by every record that
 * names it as a parent. One function each is what makes that a property rather than a hope.
 */

/** The one class per program that holds its attendance sessions. Nothing here corresponds to it. */
export function attendanceClassId(programId: string): string {
  return `attendance:${programId}`;
}

/** A fellow in a course: the pair, because there is no table. */
export function registrationKey(courseId: string, enrollmentId: string): string {
  return `${courseId}:${enrollmentId}`;
}

/**
 * A fellow on an assignment: the pair rather than the `submissions` row's id.
 *
 * A row is created when a fellow first accepts or hands in, so a fellow who has not started has
 * no row and no UUID — but Salesforce holds an Assignment Submission for every fellow on every
 * assignment from the day it is distributed. Keying on the pair means the record Salesforce holds
 * for somebody who has not started is the same record that later carries their grade.
 */
export function submissionKey(assignmentId: string, enrollmentId: string): string {
  return `${assignmentId}:${enrollmentId}`;
}

/** The later of two instants, for a computed record whose position is the later of its parents'. */
export function later(a: Date, b: Date): Date {
  return a > b ? a : b;
}

export type FeedStatus = "notStarted" | "inProgress" | "submitted" | "graded";

/**
 * Eight statuses onto four.
 *
 * `DRAFT_READY`, `GRADING_FAILED`, and `NEEDS_MANUAL_REVIEW` describe the grading pipeline, not
 * the work, and to anyone outside it all three mean "handed in, not yet graded". `RESUBMITTED` is
 * the same fact about work that was graded once already. Make maps these four onto the picklist's
 * exact spelling, which is a fact about Salesforce and is kept there.
 */
export function collapseStatus(status: SubmissionStatus): FeedStatus {
  switch (status) {
    case "NOT_STARTED":
      return "notStarted";
    case "ACCEPTED":
      return "inProgress";
    case "SUBMITTED":
    case "RESUBMITTED":
    case "DRAFT_READY":
    case "GRADING_FAILED":
    case "NEEDS_MANUAL_REVIEW":
      return "submitted";
    case "GRADED":
      return "graded";
  }
}

export type AssignmentType = "assignment" | "project" | "assessment";

/**
 * Salesforce's three types, from the category of the unit the assignment sits in.
 *
 * The distinction Salesforce draws is where the work sits in the curriculum, not how it is handed
 * in — which is why `CourseUnitCategory` answers this and `AssignmentKind` does not.
 */
export function assignmentType(category: CourseUnitCategory): AssignmentType {
  switch (category) {
    case "MODULE":
      return "assignment";
    case "PROJECT":
      return "project";
    case "ASSESSMENT":
      return "assessment";
  }
}

/**
 * One point for a task, the column for everything else.
 *
 * `assignmentPointValue` in `lib/assignments/spec.ts` computes the same answer from the
 * assignment's sections. The feed holds no sections and needs none: a task is worth one point by
 * rule, and every other kind keeps its total in the column. This is that function's one-sentence
 * content, written here rather than reached for.
 */
export function pointValueOf(assignment: { kind: AssignmentKind; pointValue: number }): number {
  return assignment.kind === "TASK" ? 1 : assignment.pointValue;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/lib/integrations/salesforce/records.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Format, lint, typecheck, commit**

```bash
npm run format && npm run lint && npm run typecheck
git add lib/integrations/salesforce/records.ts tests/lib/integrations/salesforce/records.test.ts
git commit -F - <<'MSG'
The feed spells its identifiers in one place, and eight statuses become four

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 4: The record mappers

**Files:**
- Modify: `lib/integrations/salesforce/records.ts` (append)
- Test: `tests/lib/integrations/salesforce/records.test.ts` (append)

**Interfaces:**
- Consumes: `Positioned` from Task 1; `attendanceClassId`, `registrationKey`, `submissionKey`, `later`, `collapseStatus`, `assignmentType`, `pointValueOf` from Task 3; `schoolDayFromColumn` from `lib/school-time.ts`; `lateness` and `type Lateness` from `lib/submissions/hand-in.ts`.
- Produces one record type and one mapper per collection, each record extending `Positioned`:
  - `ProgramRecord`, `programRecord(row)`
  - `EnrollmentRecord`, `enrollmentRecord(row)`
  - `ClassRecord`, `classRecord(row)`, `attendanceClassRecord(program)`
  - `RegistrationRecord`, `registrationRecord(course, enrollment)`
  - `AssignmentRecord`, `assignmentRecord(row)`
  - `SessionRecord`, `sessionRecord(row)`
  - `AttendanceFeedRecord`, `attendanceRecord(row)`
  - `SubmissionRecord`, `type SubmissionPair`, `type SubmissionRow`, `submissionRecord(pair, row | null)`
  - `GcfAttemptRecord`, `gcfAttemptRecord(row)`

  Exact row shapes are in the implementation below; Task 5–8's `select`s produce exactly them.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/integrations/salesforce/records.test.ts` — extend the import at the top to:

```ts
import {
  assignmentRecord,
  assignmentType,
  attendanceClassId,
  attendanceClassRecord,
  attendanceRecord,
  classRecord,
  collapseStatus,
  enrollmentRecord,
  gcfAttemptRecord,
  later,
  pointValueOf,
  programRecord,
  registrationKey,
  registrationRecord,
  sessionRecord,
  submissionKey,
  submissionRecord,
} from "@/lib/integrations/salesforce/records";
```

and add at the end of the file:

```ts
const UPDATED = new Date("2026-09-22T14:00:00.000Z");
const EARLIER = new Date("2026-09-21T14:00:00.000Z");

describe("programRecord and enrollmentRecord", () => {
  it("carries what the setup scenario matches on and stamps with", () => {
    expect(
      programRecord({
        id: "p1",
        name: "Software Engineering",
        term: "Fall 2026",
        discipline: "SOFTWARE_ENGINEERING",
        updatedAt: UPDATED,
      }),
    ).toEqual({
      externalId: "p1",
      name: "Software Engineering",
      term: "Fall 2026",
      discipline: "SOFTWARE_ENGINEERING",
      updatedAt: UPDATED,
    });

    expect(
      enrollmentRecord({
        id: "e1",
        programId: "p1",
        status: "ACTIVE",
        updatedAt: UPDATED,
        student: { id: "s1", email: "ada@example.test", displayName: "Ada" },
      }),
    ).toEqual({
      externalId: "e1",
      programId: "p1",
      studentId: "s1",
      studentEmail: "ada@example.test",
      studentName: "Ada",
      status: "ACTIVE",
      updatedAt: UPDATED,
    });
  });
});

describe("classRecord and attendanceClassRecord", () => {
  it("names a course's program and whether it is archived", () => {
    expect(
      classRecord({ id: "c1", programId: "p1", name: "Seminar", archivedAt: null, updatedAt: UPDATED }),
    ).toEqual({ externalId: "c1", programId: "p1", name: "Seminar", archived: false, updatedAt: UPDATED });
    expect(
      classRecord({ id: "c1", programId: "p1", name: "Seminar", archivedAt: EARLIER, updatedAt: UPDATED })
        .archived,
    ).toBe(true);
  });

  it("makes one Attendance class per program, positioned with the program", () => {
    expect(attendanceClassRecord({ id: "p1", updatedAt: UPDATED })).toEqual({
      externalId: "attendance:p1",
      programId: "p1",
      name: "Attendance",
      archived: false,
      updatedAt: UPDATED,
    });
  });
});

describe("registrationRecord", () => {
  it("keys on the pair and is positioned at the later of the two", () => {
    const record = registrationRecord(
      { id: "c1", updatedAt: EARLIER },
      { id: "e1", status: "REMOVED", updatedAt: UPDATED },
    );
    expect(record).toEqual({
      externalId: "c1:e1",
      classId: "c1",
      enrollmentId: "e1",
      enrollmentStatus: "REMOVED",
      updatedAt: UPDATED,
    });
  });
});

describe("assignmentRecord", () => {
  it("reads type from the unit and point value by the task rule", () => {
    expect(
      assignmentRecord({
        id: "a1",
        courseId: "c1",
        title: "Build a thing",
        kind: "TASK",
        pointValue: 99,
        dueAt: null,
        updatedAt: UPDATED,
        courseUnit: { category: "ASSESSMENT" },
      }),
    ).toEqual({
      externalId: "a1",
      classId: "c1",
      title: "Build a thing",
      type: "assessment",
      pointValue: 1,
      dueAt: null,
      updatedAt: UPDATED,
    });
  });
});

describe("sessionRecord and attendanceRecord", () => {
  it("names the program's Attendance class and emits the day as a string", () => {
    expect(
      sessionRecord({
        id: "s1",
        programId: "p1",
        date: new Date("2026-09-14T00:00:00Z"),
        startedAt: null,
        endedAt: null,
        updatedAt: UPDATED,
      }),
    ).toEqual({
      externalId: "s1",
      classId: "attendance:p1",
      date: "2026-09-14",
      startedAt: null,
      endedAt: null,
      updatedAt: UPDATED,
    });
  });

  it("carries status, source, and the check-in instant", () => {
    const checkedInAt = new Date("2026-09-14T13:04:00Z");
    expect(
      attendanceRecord({
        id: "r1",
        sessionId: "s1",
        enrollmentId: "e1",
        status: "LATE",
        source: "SELF_CHECK_IN",
        checkedInAt,
        note: null,
        updatedAt: UPDATED,
      }),
    ).toEqual({
      externalId: "r1",
      sessionId: "s1",
      enrollmentId: "e1",
      status: "LATE",
      source: "SELF_CHECK_IN",
      checkedInAt,
      note: null,
      updatedAt: UPDATED,
    });
  });
});

describe("submissionRecord", () => {
  const pair = {
    assignment: { id: "a1", courseId: "c1", dueAt: new Date("2026-02-01T05:00:00Z"), updatedAt: EARLIER },
    enrollment: { id: "e1", updatedAt: UPDATED },
  };

  it("is notStarted with every grade field null when there is no row, positioned at the later parent", () => {
    expect(submissionRecord(pair, null)).toEqual({
      externalId: "a1:e1",
      assignmentId: "a1",
      registrationId: "c1:e1",
      status: "notStarted",
      submittedAt: null,
      score: null,
      scorePossible: null,
      isComplete: null,
      lateness: null,
      gradedAt: null,
      feedbackMarkdown: null,
      updatedAt: UPDATED,
    });
  });

  it("carries a released grade, and lateness against the deadline", () => {
    const gradedAt = new Date("2026-02-03T12:00:00Z");
    const rowUpdated = new Date("2026-02-03T12:00:01Z");
    const record = submissionRecord(pair, {
      status: "GRADED",
      submittedAt: new Date("2026-02-02T12:00:00Z"),
      finalScore: 34,
      finalScorePossible: 40,
      isComplete: true,
      gradedAt,
      feedbackMarkdown: "Good.",
      extendedDueAt: null,
      updatedAt: rowUpdated,
    });
    expect(record.status).toBe("graded");
    expect(record.score).toBe(34);
    expect(record.scorePossible).toBe(40);
    expect(record.isComplete).toBe(true);
    expect(record.lateness).toBe("late");
    expect(record.gradedAt).toBe(gradedAt);
    expect(record.feedbackMarkdown).toBe("Good.");
    expect(record.updatedAt).toBe(rowUpdated);
  });

  it("reads extended when the hand-in beat an agreed extension", () => {
    const record = submissionRecord(pair, {
      status: "SUBMITTED",
      submittedAt: new Date("2026-02-02T12:00:00Z"),
      finalScore: null,
      finalScorePossible: null,
      isComplete: null,
      gradedAt: null,
      feedbackMarkdown: null,
      extendedDueAt: new Date("2026-02-05T05:00:00Z"),
      updatedAt: UPDATED,
    });
    expect(record.lateness).toBe("extended");
    expect(record.status).toBe("submitted");
  });

  it("withholds the grade fields on a row that is not GRADED, even if the columns hold old values", () => {
    const record = submissionRecord(pair, {
      status: "RESUBMITTED",
      submittedAt: new Date("2026-02-04T12:00:00Z"),
      finalScore: 20,
      finalScorePossible: 40,
      isComplete: false,
      gradedAt: new Date("2026-02-03T12:00:00Z"),
      feedbackMarkdown: "Old feedback.",
      extendedDueAt: null,
      updatedAt: UPDATED,
    });
    expect(record.status).toBe("submitted");
    expect(record.score).toBeNull();
    expect(record.scorePossible).toBeNull();
    expect(record.isComplete).toBeNull();
    expect(record.gradedAt).toBeNull();
    expect(record.feedbackMarkdown).toBeNull();
  });

  it("has null lateness on a row with no hand-in", () => {
    const record = submissionRecord(pair, {
      status: "ACCEPTED",
      submittedAt: null,
      finalScore: null,
      finalScorePossible: null,
      isComplete: null,
      gradedAt: null,
      feedbackMarkdown: null,
      extendedDueAt: null,
      updatedAt: UPDATED,
    });
    expect(record.status).toBe("inProgress");
    expect(record.lateness).toBeNull();
  });
});

describe("gcfAttemptRecord", () => {
  const row = {
    id: "g1",
    kind: "PROCTORED" as const,
    score: 512,
    scorePossible: null,
    takenOn: new Date("2026-09-10T00:00:00Z"),
    integrityFlagged: false,
    resultUrl: null,
    updatedAt: UPDATED,
  };

  it("names the Contact and the most recent enrollment, and emits the day as a string", () => {
    expect(gcfAttemptRecord({ ...row, student: { id: "s1", enrollments: [{ id: "e2" }] } })).toEqual({
      externalId: "g1",
      enrollmentId: "e2",
      contactId: "s1",
      kind: "PROCTORED",
      score: 512,
      scorePossible: null,
      takenOn: "2026-09-10",
      integrityFlagged: false,
      resultUrl: null,
      updatedAt: UPDATED,
    });
  });

  it("has a null enrollment for a fellow with none", () => {
    expect(gcfAttemptRecord({ ...row, student: { id: "s1", enrollments: [] } }).enrollmentId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/lib/integrations/salesforce/records.test.ts`
Expected: FAIL — the new names are not exported.

- [ ] **Step 3: Write the implementation**

Change the import block at the top of `lib/integrations/salesforce/records.ts` to:

```ts
import type {
  AssignmentKind,
  AttendanceSource,
  AttendanceStatus,
  CourseUnitCategory,
  Discipline,
  EnrollmentStatus,
  GcfKind,
  SubmissionStatus,
} from "@/lib/generated/prisma/enums";

import { schoolDayFromColumn } from "@/lib/school-time";
import { lateness, type Lateness } from "@/lib/submissions/hand-in";

import type { Positioned } from "./cursor";
```

Then append to the end of the file:

```ts
// ---------------------------------------------------------------------------------------------
// One record type and one mapper per collection. Each row type below is exactly what the matching
// query in `collections.ts` selects; a mapper takes no more than it emits.
// ---------------------------------------------------------------------------------------------

export type ProgramRecord = Positioned & { name: string; term: string; discipline: Discipline };

export function programRecord(row: {
  id: string;
  name: string;
  term: string;
  discipline: Discipline;
  updatedAt: Date;
}): ProgramRecord {
  return {
    externalId: row.id,
    name: row.name,
    term: row.term,
    discipline: row.discipline,
    updatedAt: row.updatedAt,
  };
}

/**
 * The one record that carries an email address.
 *
 * It is what the setup scenario matches a Program Enrollment on, once. `studentId` is what the
 * Contact is then stamped with — the fellow's own identifier rather than the enrollment's,
 * because a fellow who repeats a term has two enrollments and one Contact.
 */
export type EnrollmentRecord = Positioned & {
  programId: string;
  studentId: string;
  studentEmail: string | null;
  studentName: string | null;
  status: EnrollmentStatus;
};

export function enrollmentRecord(row: {
  id: string;
  programId: string;
  status: EnrollmentStatus;
  updatedAt: Date;
  student: { id: string; email: string | null; displayName: string | null };
}): EnrollmentRecord {
  return {
    externalId: row.id,
    programId: row.programId,
    studentId: row.student.id,
    studentEmail: row.student.email,
    studentName: row.student.displayName,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

export type ClassRecord = Positioned & { programId: string; name: string; archived: boolean };

export function classRecord(row: {
  id: string;
  programId: string;
  name: string;
  archivedAt: Date | null;
  updatedAt: Date;
}): ClassRecord {
  return {
    externalId: row.id,
    programId: row.programId,
    name: row.name,
    archived: row.archivedAt !== null,
    updatedAt: row.updatedAt,
  };
}

/**
 * The Attendance class, made up rather than looked up.
 *
 * Marcy's practice is one Salesforce class per program that exists only to hold the sessions.
 * Nothing here corresponds to it, so the `classes` collection emits it and the `sessions`
 * collection names it as parent. Positioned with the program, so it appears when the program does.
 */
export function attendanceClassRecord(program: { id: string; updatedAt: Date }): ClassRecord {
  return {
    externalId: attendanceClassId(program.id),
    programId: program.id,
    name: "Attendance",
    archived: false,
    updatedAt: program.updatedAt,
  };
}

export type RegistrationRecord = Positioned & {
  classId: string;
  enrollmentId: string;
  enrollmentStatus: EnrollmentStatus;
};

/** A course and an enrollment in its program. Positioned at the later of the two, so a change to either moves it. */
export function registrationRecord(
  course: { id: string; updatedAt: Date },
  enrollment: { id: string; status: EnrollmentStatus; updatedAt: Date },
): RegistrationRecord {
  return {
    externalId: registrationKey(course.id, enrollment.id),
    classId: course.id,
    enrollmentId: enrollment.id,
    enrollmentStatus: enrollment.status,
    updatedAt: later(course.updatedAt, enrollment.updatedAt),
  };
}

export type AssignmentRecord = Positioned & {
  classId: string;
  title: string;
  type: AssignmentType;
  pointValue: number;
  dueAt: Date | null;
};

export function assignmentRecord(row: {
  id: string;
  courseId: string;
  title: string;
  kind: AssignmentKind;
  pointValue: number;
  dueAt: Date | null;
  updatedAt: Date;
  courseUnit: { category: CourseUnitCategory };
}): AssignmentRecord {
  return {
    externalId: row.id,
    classId: row.courseId,
    title: row.title,
    type: assignmentType(row.courseUnit.category),
    pointValue: pointValueOf(row),
    dueAt: row.dueAt,
    updatedAt: row.updatedAt,
  };
}

export type SessionRecord = Positioned & {
  classId: string;
  /** A civil date, `YYYY-MM-DD`. Never a `Date` — see `lib/school-time.ts`. */
  date: string;
  startedAt: Date | null;
  endedAt: Date | null;
};

export function sessionRecord(row: {
  id: string;
  programId: string;
  date: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date;
}): SessionRecord {
  return {
    externalId: row.id,
    classId: attendanceClassId(row.programId),
    date: schoolDayFromColumn(row.date),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    updatedAt: row.updatedAt,
  };
}

/** Named `AttendanceFeedRecord` because `AttendanceRecord` is the Prisma model. */
export type AttendanceFeedRecord = Positioned & {
  sessionId: string;
  enrollmentId: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  checkedInAt: Date | null;
  note: string | null;
};

export function attendanceRecord(row: {
  id: string;
  sessionId: string;
  enrollmentId: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  checkedInAt: Date | null;
  note: string | null;
  updatedAt: Date;
}): AttendanceFeedRecord {
  return {
    externalId: row.id,
    sessionId: row.sessionId,
    enrollmentId: row.enrollmentId,
    status: row.status,
    source: row.source,
    checkedInAt: row.checkedInAt,
    note: row.note,
    updatedAt: row.updatedAt,
  };
}

export type SubmissionRecord = Positioned & {
  assignmentId: string;
  registrationId: string;
  status: FeedStatus;
  submittedAt: Date | null;
  score: number | null;
  scorePossible: number | null;
  isComplete: boolean | null;
  lateness: Lateness | null;
  gradedAt: Date | null;
  feedbackMarkdown: string | null;
};

/** The assignment and the enrollment a record is about. Present for every fellow on every distributed assignment. */
export type SubmissionPair = {
  assignment: { id: string; courseId: string; dueAt: Date | null; updatedAt: Date };
  enrollment: { id: string; updatedAt: Date };
};

/** The `submissions` row, when the fellow has started. Exactly what `collections.ts` selects. */
export type SubmissionRow = {
  status: SubmissionStatus;
  submittedAt: Date | null;
  finalScore: number | null;
  finalScorePossible: number | null;
  isComplete: boolean | null;
  gradedAt: Date | null;
  feedbackMarkdown: string | null;
  extendedDueAt: Date | null;
  updatedAt: Date;
};

/**
 * One fellow on one assignment, whether or not they have started.
 *
 * **Without a row** the record is `notStarted` with every grade field null, positioned at the
 * later of its two parents — so a newly distributed assignment produces a page of new records,
 * and a fellow joining late produces one per assignment already out.
 *
 * **With a row**, the grade travels only once released: `status = GRADED` with `gradedAt` set,
 * which is exactly what `sharedAfterGrade` writes. A `RESUBMITTED` row still holds the previous
 * grade in its columns, and that grade is withheld, because the work standing is not the work
 * that grade described. Work graded but not released lives in `grading_drafts` and never reaches
 * this row at all.
 *
 * `lateness` is null until something was handed in. The function it calls answers "onTime" for a
 * null hand-in, which is the right answer for a dashboard and the wrong one for a record — nothing
 * about work that has not arrived is on time.
 */
export function submissionRecord(pair: SubmissionPair, row: SubmissionRow | null): SubmissionRecord {
  const identity = {
    externalId: submissionKey(pair.assignment.id, pair.enrollment.id),
    assignmentId: pair.assignment.id,
    registrationId: registrationKey(pair.assignment.courseId, pair.enrollment.id),
  };

  if (row === null) {
    return {
      ...identity,
      status: "notStarted",
      submittedAt: null,
      score: null,
      scorePossible: null,
      isComplete: null,
      lateness: null,
      gradedAt: null,
      feedbackMarkdown: null,
      updatedAt: later(pair.assignment.updatedAt, pair.enrollment.updatedAt),
    };
  }

  const released = row.status === "GRADED" && row.gradedAt !== null;

  return {
    ...identity,
    status: collapseStatus(row.status),
    submittedAt: row.submittedAt,
    score: released ? row.finalScore : null,
    scorePossible: released ? row.finalScorePossible : null,
    isComplete: released ? row.isComplete : null,
    lateness:
      row.submittedAt === null
        ? null
        : lateness({
            dueAt: pair.assignment.dueAt,
            submittedAt: row.submittedAt,
            extendedDueAt: row.extendedDueAt,
          }),
    gradedAt: released ? row.gradedAt : null,
    feedbackMarkdown: released ? row.feedbackMarkdown : null,
    updatedAt: row.updatedAt,
  };
}

export type GcfAttemptRecord = Positioned & {
  /** The fellow's most recent enrollment. Null for a fellow with none, which Make's error branch should catch. */
  enrollmentId: string | null;
  contactId: string;
  kind: GcfKind;
  score: number;
  scorePossible: number | null;
  /** A civil date, `YYYY-MM-DD`. */
  takenOn: string;
  integrityFlagged: boolean;
  resultUrl: string | null;
};

/**
 * An attempt belongs to a person and carries no program; an Artifact belongs to a Program
 * Enrollment and also names the Contact. The query hands over the student's single most recent
 * enrollment, and this reads it — for nearly everyone their only one.
 */
export function gcfAttemptRecord(row: {
  id: string;
  kind: GcfKind;
  score: number;
  scorePossible: number | null;
  takenOn: Date;
  integrityFlagged: boolean;
  resultUrl: string | null;
  updatedAt: Date;
  student: { id: string; enrollments: { id: string }[] };
}): GcfAttemptRecord {
  return {
    externalId: row.id,
    enrollmentId: row.student.enrollments[0]?.id ?? null,
    contactId: row.student.id,
    kind: row.kind,
    score: row.score,
    scorePossible: row.scorePossible,
    takenOn: schoolDayFromColumn(row.takenOn),
    integrityFlagged: row.integrityFlagged,
    resultUrl: row.resultUrl,
    updatedAt: row.updatedAt,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/lib/integrations/salesforce/records.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Format, lint, typecheck, commit**

```bash
npm run format && npm run lint && npm run typecheck
git add lib/integrations/salesforce/records.ts tests/lib/integrations/salesforce/records.test.ts
git commit -F - <<'MSG'
A row becomes the record Make upserts, one mapper per collection

An unstarted submission is a record with every grade field null, keyed on
the assignment and the enrollment, so the record Salesforce holds before a
fellow starts is the one that later carries their grade. A grade travels
only once released, which withholds the previous grade on resubmitted work.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 5: Programs, enrollments, and classes

**Files:**
- Create: `lib/integrations/salesforce/collections.ts`
- Create: `tests/integration/salesforce-feed.test.ts`

**Interfaces:**
- Consumes: `Tx` from `@/lib/prisma`; `cursorWhere`, `pageOf`, `walk`, `FeedQuery`, `Page`, `Positioned`, `Cursor` from Task 1; the mappers from Task 4; `makeWorld`, `makeProgram`, `makeCourse`, `enroll` from `tests/integration/fixtures.ts`; `withRollback` from `tests/integration/transaction.ts`.
- Produces:
  - `type Collection = (tx: Tx, query: FeedQuery) => Promise<Page<Positioned>>`
  - `const COLLECTION_NAMES = ["programs", "enrollments", "classes", "registrations", "assignments", "sessions", "attendance", "submissions", "gcf-attempts"] as const`
  - `type CollectionName = (typeof COLLECTION_NAMES)[number]`
  - `isCollectionName(value: string): value is CollectionName`
  - `const COLLECTIONS: Record<CollectionName, Collection>` — this task fills three entries and leaves the other six as a function that throws `not built yet`, which Tasks 6–8 replace.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/salesforce-feed.test.ts`:

```ts
/**
 * The Salesforce feed: every collection, walked against real rows inside a rolled-back
 * transaction.
 *
 * Run with `npm run test:integration`.
 *
 * What makes these need a database rather than a fixture is the cursor: the promise is that a
 * walk returns every record exactly once and then stops, and that promise is about what Prisma
 * writes into `updatedAt` and how Postgres orders it, neither of which a unit test can ask. Every
 * walk here uses a page size small enough to force several pages, so the cursor is exercised
 * rather than assumed.
 *
 * **Assertions are scoped to this suite's own rows.** The database may hold seeded rows and rows
 * other suites left behind, so a check never says "the collection has three records" — it says
 * "these three identifiers are present, once each, and this one is absent".
 */
import type { Cursor, Positioned } from "@/lib/integrations/salesforce/cursor";
import {
  COLLECTIONS,
  COLLECTION_NAMES,
  isCollectionName,
  type Collection,
} from "@/lib/integrations/salesforce/collections";
import { attendanceClassId } from "@/lib/integrations/salesforce/records";

import { enroll, makeAccount, makeCourse, makeWorld, type World } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

/** A test-student number no seed uses; unique across the deployment, so it must not collide. */
const FAKE_TEST_STUDENT_NUMBER = 987_654;

/**
 * Walk a collection to the end at a small page size, collecting every record.
 *
 * Throws if the walk does not terminate, which is what a cursor that lands *on* its last record
 * rather than after it looks like — the same page forever.
 */
async function walkAll<R extends Positioned>(
  tx: Tx,
  collection: Collection,
  limit: number,
): Promise<R[]> {
  const out: Positioned[] = [];
  let cursor: Cursor = null;

  for (let pages = 0; pages < 10_000; pages += 1) {
    const page = await collection(tx, { cursor, limit });
    out.push(...page.records);
    if (!page.hasMore) return out as R[];
    if (page.cursor === null) throw new Error("hasMore without a cursor");
    cursor = { since: new Date(page.cursor.since), after: page.cursor.after };
  }

  throw new Error("the walk did not terminate");
}

/** The identifiers among `records` that are also in `ours`, so a check reads only this suite's rows. */
function oursAmong(records: Positioned[], ours: Set<string>): string[] {
  return records.map((record) => record.externalId).filter((id) => ours.has(id));
}

describe("the Salesforce feed", () => {
  const tx = withRollback(180_000);

  let world: World;
  /** A second program and its course, so that a check can show a record stays inside its own. */
  let otherProgramId: string;
  let otherCourseId: string;
  /** The fellow marked as a test student, who must appear nowhere. */
  let testStudent: { id: string; studentId: string };

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 3, published: true });
    testStudent = world.students[2];
    await tx().profile.update({
      where: { id: testStudent.studentId },
      data: { testStudentNumber: FAKE_TEST_STUDENT_NUMBER },
    });

    const other = await makeWorld(tx(), { students: 1, published: true });
    otherProgramId = other.programId;
    otherCourseId = other.courseId;
  });

  describe("the table of collections", () => {
    it("names the nine collections and nothing else", () => {
      expect([...COLLECTION_NAMES]).toEqual([
        "programs",
        "enrollments",
        "classes",
        "registrations",
        "assignments",
        "sessions",
        "attendance",
        "submissions",
        "gcf-attempts",
      ]);
      expect(Object.keys(COLLECTIONS).sort()).toEqual([...COLLECTION_NAMES].sort());
      expect(isCollectionName("programs")).toBe(true);
      expect(isCollectionName("Programs")).toBe(false);
      expect(isCollectionName("contacts")).toBe(false);
    });
  });

  describe("programs and enrollments", () => {
    it("walks the programs, each once", async () => {
      const records = await walkAll(tx(), COLLECTIONS.programs, 1);
      const ours = new Set([world.programId, otherProgramId]);
      expect(oursAmong(records, ours).sort()).toEqual([...ours].sort());
    });

    it("walks the enrollments with the fellow's identifier and email, and leaves the test student out", async () => {
      const records = await walkAll<
        Positioned & { studentId: string; studentEmail: string | null; programId: string }
      >(tx(), COLLECTIONS.enrollments, 1);
      const ours = new Set(world.students.map((student) => student.id));
      const seen = oursAmong(records, ours);

      expect(seen.sort()).toEqual([world.students[0].id, world.students[1].id].sort());
      expect(seen).not.toContain(testStudent.id);

      const first = records.find((record) => record.externalId === world.students[0].id)!;
      expect(first.studentId).toBe(world.students[0].studentId);
      expect(first.studentEmail).toMatch(/@example\.test$/);
      expect(first.programId).toBe(world.programId);
    });
  });

  describe("classes", () => {
    let unpublishedCourseId: string;

    beforeAll(async () => {
      const unpublished = await makeCourse(tx(), { programId: world.programId, published: false });
      unpublishedCourseId = unpublished.id;
    });

    it("emits every published course and one Attendance class per program, and no unpublished course", async () => {
      const records = await walkAll<Positioned & { programId: string; name: string }>(
        tx(),
        COLLECTIONS.classes,
        1,
      );
      const ours = new Set([
        world.courseId,
        unpublishedCourseId,
        attendanceClassId(world.programId),
        attendanceClassId(otherProgramId),
      ]);
      const seen = oursAmong(records, ours);

      expect(seen.sort()).toEqual(
        [world.courseId, attendanceClassId(world.programId), attendanceClassId(otherProgramId)].sort(),
      );
      expect(seen).not.toContain(unpublishedCourseId);

      const attendance = records.find((record) => record.externalId === attendanceClassId(world.programId))!;
      expect(attendance.name).toBe("Attendance");
      expect(attendance.programId).toBe(world.programId);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- tests/integration/salesforce-feed.test.ts`
Expected: FAIL — `Cannot find module '@/lib/integrations/salesforce/collections'`.

(If the run reports that no local test database exists, run `npm run db:test:reset` first; the suite's header comment in `jest.integration.setup.mjs` says why.)

- [ ] **Step 3: Write the implementation**

Create `lib/integrations/salesforce/collections.ts`:

```ts
import "server-only";

import type { Tx } from "@/lib/prisma";

import { cursorWhere, pageOf, walk, type FeedQuery, type Page, type Positioned } from "./cursor";
import { attendanceClassRecord, classRecord, enrollmentRecord, programRecord } from "./records";

/**
 * The nine collections the Salesforce feed serves, and the queries behind them.
 *
 * This is the only module in the feed that runs a query. Each collection is a function from a
 * client and a parsed query to a page; `feed.ts` looks the name up here and calls it. Seven read
 * one table each, adding `cursorWhere` to their own conditions and letting Postgres order and cut.
 * Two — `registrations` and `submissions` — have no table, so they load the small tables they are
 * made from and hand the computed records to `walk`.
 *
 * **Test students are filtered here, in every query that reaches a profile.** Their rows are
 * fabrications and must never reach a system of record; the screens that draw a whole roster
 * filter on the same column themselves, and this is that rule applied at the edge.
 *
 * **Ordered in the table below as Make must run them.** A child upsert fails in Salesforce when
 * its parent is not there yet, and the order here is the dependency order. The route does not
 * enforce it — a caller may read any collection at any time — but a reader of this file should
 * see it.
 */

export type Collection = (tx: Tx, query: FeedQuery) => Promise<Page<Positioned>>;

export const COLLECTION_NAMES = [
  "programs",
  "enrollments",
  "classes",
  "registrations",
  "assignments",
  "sessions",
  "attendance",
  "submissions",
  "gcf-attempts",
] as const;

export type CollectionName = (typeof COLLECTION_NAMES)[number];

export function isCollectionName(value: string): value is CollectionName {
  return (COLLECTION_NAMES as readonly string[]).includes(value);
}

/** Every query that reaches a profile spreads this into its `where`. */
const NOT_A_TEST_STUDENT = { student: { testStudentNumber: null } } as const;

const programs: Collection = async (tx, query) => {
  const rows = await tx.program.findMany({
    where: cursorWhere(query.cursor),
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: { id: true, name: true, term: true, discipline: true, updatedAt: true },
  });
  return pageOf(rows.map(programRecord), query.limit);
};

const enrollments: Collection = async (tx, query) => {
  const rows = await tx.enrollment.findMany({
    where: { ...cursorWhere(query.cursor), ...NOT_A_TEST_STUDENT },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      programId: true,
      status: true,
      updatedAt: true,
      student: { select: { id: true, email: true, displayName: true } },
    },
  });
  return pageOf(rows.map(enrollmentRecord), query.limit);
};

/**
 * Published courses, plus one Attendance class per program.
 *
 * Two queries, merged and cut by `walk`. The course half is cursored exactly in SQL, because a
 * course's identifier is its id. The program half cannot be: the synthetic identifier
 * `attendance:<id>` is not a column, so `after` has nothing to compare against, and a `take` on an
 * inexactly filtered list could push a needed program off the page and skip it for good. Programs
 * number in the tens, ever. So the program half asks only by instant — every program at or after
 * `since`, no `take` — and `walk` applies the real identifier and cuts. The merge is correct
 * because the first `limit + 1` records of the merged order are within the first `limit + 1` of
 * the courses or within the complete list of programs.
 */
const classes: Collection = async (tx, query) => {
  const [courses, programRows] = await Promise.all([
    tx.course.findMany({
      where: { ...cursorWhere(query.cursor), publishedAt: { not: null } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      select: { id: true, programId: true, name: true, archivedAt: true, updatedAt: true },
    }),
    tx.program.findMany({
      where: query.cursor === null ? {} : { updatedAt: { gte: query.cursor.since } },
      select: { id: true, updatedAt: true },
    }),
  ]);

  return walk([...courses.map(classRecord), ...programRows.map(attendanceClassRecord)], query);
};

const notBuiltYet =
  (name: CollectionName): Collection =>
  async () => {
    throw new Error(`${name} is not built yet`);
  };

export const COLLECTIONS: Record<CollectionName, Collection> = {
  programs,
  enrollments,
  classes,
  registrations: notBuiltYet("registrations"),
  assignments: notBuiltYet("assignments"),
  sessions: notBuiltYet("sessions"),
  attendance: notBuiltYet("attendance"),
  submissions: notBuiltYet("submissions"),
  "gcf-attempts": notBuiltYet("gcf-attempts"),
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- tests/integration/salesforce-feed.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Format, lint, typecheck, commit**

```bash
npm run format && npm run lint && npm run typecheck
git add lib/integrations/salesforce/collections.ts tests/integration/salesforce-feed.test.ts
git commit -F - <<'MSG'
Programs, enrollments, and classes, walked from real rows

The first three collections, and the table the route will look names up
in. Classes merge published courses with one made-up Attendance class per
program. The program half is loaded whole past the instant, because a
synthetic identifier has no column to compare against and a cut list
could skip a program for good.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 6: Assignments, sessions, attendance, and GCF attempts

**Files:**
- Modify: `lib/integrations/salesforce/collections.ts`
- Modify: `tests/integration/salesforce-feed.test.ts` (append)

**Interfaces:**
- Consumes: `assignmentRecord`, `sessionRecord`, `attendanceRecord`, `gcfAttemptRecord` from Task 4; `makeAssignment`, `makeUnit` from fixtures.
- Produces: four more entries in `COLLECTIONS`, replacing their `notBuiltYet` placeholders.

- [ ] **Step 1: Write the failing integration tests**

Extend the fixtures import at the top of `tests/integration/salesforce-feed.test.ts` to:

```ts
import { enroll, makeAccount, makeAssignment, makeCourse, makeUnit, makeWorld, type World } from "./fixtures";
```

Append inside the outer `describe("the Salesforce feed", ...)`, after the `classes` block:

```ts
  describe("assignments", () => {
    let distributedId: string;
    let undistributedId: string;
    let assessmentId: string;

    beforeAll(async () => {
      const distributed = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: world.unitId,
        kind: "TASK",
        pointValue: 50,
      });
      distributedId = distributed.id;

      const undistributed = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: world.unitId,
        published: false,
      });
      undistributedId = undistributed.id;

      const assessmentUnit = await makeUnit(tx(), { courseId: world.courseId });
      await tx().courseUnit.update({ where: { id: assessmentUnit.id }, data: { category: "ASSESSMENT" } });
      const assessment = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: assessmentUnit.id,
        kind: "REPO",
        pointValue: 40,
      });
      assessmentId = assessment.id;
    });

    it("emits distributed assignments with type and point value, and no drafts", async () => {
      const records = await walkAll<Positioned & { classId: string; type: string; pointValue: number }>(
        tx(),
        COLLECTIONS.assignments,
        1,
      );
      const ours = new Set([distributedId, undistributedId, assessmentId]);
      const seen = oursAmong(records, ours);

      expect(seen.sort()).toEqual([distributedId, assessmentId].sort());
      expect(seen).not.toContain(undistributedId);

      const task = records.find((record) => record.externalId === distributedId)!;
      expect(task.classId).toBe(world.courseId);
      expect(task.type).toBe("assignment");
      expect(task.pointValue).toBe(1);

      const assessment = records.find((record) => record.externalId === assessmentId)!;
      expect(assessment.type).toBe("assessment");
      expect(assessment.pointValue).toBe(40);
    });
  });

  describe("sessions and attendance", () => {
    let sessionId: string;
    let presentRecordId: string;
    let testStudentRecordId: string;

    beforeAll(async () => {
      const session = await tx().attendanceSession.create({
        data: {
          programId: world.programId,
          date: new Date("2026-09-14T00:00:00Z"),
          startedAt: new Date("2026-09-14T13:00:00Z"),
          endsAt: new Date("2026-09-14T14:00:00Z"),
          lateAfterMinutes: 5,
          codeSecret: "integration-secret",
        },
        select: { id: true },
      });
      sessionId = session.id;

      const present = await tx().attendanceRecord.create({
        data: {
          sessionId,
          programId: world.programId,
          enrollmentId: world.students[0].id,
          status: "PRESENT",
          source: "SELF_CHECK_IN",
          checkedInAt: new Date("2026-09-14T13:02:00Z"),
        },
        select: { id: true },
      });
      presentRecordId = present.id;

      const ofTestStudent = await tx().attendanceRecord.create({
        data: {
          sessionId,
          programId: world.programId,
          enrollmentId: testStudent.id,
          status: "PRESENT",
          source: "SELF_CHECK_IN",
          checkedInAt: new Date("2026-09-14T13:03:00Z"),
        },
        select: { id: true },
      });
      testStudentRecordId = ofTestStudent.id;
    });

    it("emits the session under the program's Attendance class with its day as a string", async () => {
      const records = await walkAll<Positioned & { classId: string; date: string }>(
        tx(),
        COLLECTIONS.sessions,
        1,
      );
      const session = records.find((record) => record.externalId === sessionId)!;
      expect(session.classId).toBe(attendanceClassId(world.programId));
      expect(session.date).toBe("2026-09-14");
    });

    it("emits the fellow's record and not the test student's", async () => {
      const records = await walkAll<Positioned & { sessionId: string; enrollmentId: string; status: string }>(
        tx(),
        COLLECTIONS.attendance,
        1,
      );
      const seen = oursAmong(records, new Set([presentRecordId, testStudentRecordId]));
      expect(seen).toEqual([presentRecordId]);

      const present = records.find((record) => record.externalId === presentRecordId)!;
      expect(present.sessionId).toBe(sessionId);
      expect(present.enrollmentId).toBe(world.students[0].id);
      expect(present.status).toBe("PRESENT");
    });
  });

  describe("gcf attempts", () => {
    let attemptId: string;
    let testStudentAttemptId: string;
    /** A fellow enrolled twice, to show the more recent enrollment is the one named. */
    let repeaterStudentId: string;
    let repeaterLaterEnrollmentId: string;
    let repeaterAttemptId: string;

    beforeAll(async () => {
      const attempt = await tx().gcfAttempt.create({
        data: {
          studentId: world.students[0].studentId,
          kind: "PROCTORED",
          score: 512,
          takenOn: new Date("2026-09-10T00:00:00Z"),
        },
        select: { id: true },
      });
      attemptId = attempt.id;

      const ofTestStudent = await tx().gcfAttempt.create({
        data: {
          studentId: testStudent.studentId,
          kind: "MOCK",
          score: 600,
          scorePossible: 900,
          takenOn: new Date("2026-09-10T00:00:00Z"),
        },
        select: { id: true },
      });
      testStudentAttemptId = ofTestStudent.id;

      repeaterStudentId = await makeAccount(tx());
      const earlierEnrollment = await enroll(tx(), {
        programId: otherProgramId,
        studentId: repeaterStudentId,
        status: "REMOVED",
      });
      /*
        Both enrollments are created inside one transaction, and `createdAt` defaults to the
        database's `now()` — which is the transaction's start, the same instant for both. In the
        application they are made in separate requests, months apart; here the earlier one has to
        be moved back by hand or "most recent" is a coin toss.
      */
      await tx().enrollment.update({
        where: { id: earlierEnrollment.id },
        data: { createdAt: new Date("2025-01-15T12:00:00Z") },
      });
      const laterEnrollment = await enroll(tx(), { programId: world.programId, studentId: repeaterStudentId });
      repeaterLaterEnrollmentId = laterEnrollment.id;
      const repeaterAttempt = await tx().gcfAttempt.create({
        data: {
          studentId: repeaterStudentId,
          kind: "PROCTORED",
          score: 430,
          takenOn: new Date("2026-03-01T00:00:00Z"),
        },
        select: { id: true },
      });
      repeaterAttemptId = repeaterAttempt.id;
    });

    it("names the Contact and the most recent enrollment, emits the day as a string, and leaves the test student out", async () => {
      const records = await walkAll<
        Positioned & { contactId: string; enrollmentId: string | null; takenOn: string; kind: string }
      >(tx(), COLLECTIONS["gcf-attempts"], 1);
      const seen = oursAmong(records, new Set([attemptId, testStudentAttemptId, repeaterAttemptId]));
      expect(seen.sort()).toEqual([attemptId, repeaterAttemptId].sort());

      const attempt = records.find((record) => record.externalId === attemptId)!;
      expect(attempt.contactId).toBe(world.students[0].studentId);
      expect(attempt.enrollmentId).toBe(world.students[0].id);
      expect(attempt.takenOn).toBe("2026-09-10");
      expect(attempt.kind).toBe("PROCTORED");

      const repeater = records.find((record) => record.externalId === repeaterAttemptId)!;
      expect(repeater.enrollmentId).toBe(repeaterLaterEnrollmentId);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration -- tests/integration/salesforce-feed.test.ts`
Expected: FAIL — four tests throw `... is not built yet`.

- [ ] **Step 3: Write the implementation**

In `lib/integrations/salesforce/collections.ts`, extend the records import to:

```ts
import {
  assignmentRecord,
  attendanceClassRecord,
  attendanceRecord,
  classRecord,
  enrollmentRecord,
  gcfAttemptRecord,
  programRecord,
  sessionRecord,
} from "./records";
```

Add these four collections after `classes` and before `notBuiltYet`:

```ts
/** Distributed only. An undistributed assignment is a draft no fellow has seen. */
const assignments: Collection = async (tx, query) => {
  const rows = await tx.assignment.findMany({
    where: { ...cursorWhere(query.cursor), distributedAt: { not: null } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      courseId: true,
      title: true,
      kind: true,
      pointValue: true,
      dueAt: true,
      updatedAt: true,
      courseUnit: { select: { category: true } },
    },
  });
  return pageOf(rows.map(assignmentRecord), query.limit);
};

const sessions: Collection = async (tx, query) => {
  const rows = await tx.attendanceSession.findMany({
    where: cursorWhere(query.cursor),
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: { id: true, programId: true, date: true, startedAt: true, endedAt: true, updatedAt: true },
  });
  return pageOf(rows.map(sessionRecord), query.limit);
};

const attendance: Collection = async (tx, query) => {
  const rows = await tx.attendanceRecord.findMany({
    where: { ...cursorWhere(query.cursor), enrollment: NOT_A_TEST_STUDENT },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      sessionId: true,
      enrollmentId: true,
      status: true,
      source: true,
      checkedInAt: true,
      note: true,
      updatedAt: true,
    },
  });
  return pageOf(rows.map(attendanceRecord), query.limit);
};

/**
 * Both kinds, with the fellow's most recent enrollment read through the student in the same
 * query. `take: 1` ordered by creation, so the mapper sees at most one and reads it or null.
 */
const gcfAttempts: Collection = async (tx, query) => {
  const rows = await tx.gcfAttempt.findMany({
    where: { ...cursorWhere(query.cursor), ...NOT_A_TEST_STUDENT },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      kind: true,
      score: true,
      scorePossible: true,
      takenOn: true,
      integrityFlagged: true,
      resultUrl: true,
      updatedAt: true,
      student: {
        select: {
          id: true,
          enrollments: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
        },
      },
    },
  });
  return pageOf(rows.map(gcfAttemptRecord), query.limit);
};
```

And replace the four corresponding `notBuiltYet(...)` entries in `COLLECTIONS`:

```ts
  assignments,
  sessions,
  attendance,
  "gcf-attempts": gcfAttempts,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:integration -- tests/integration/salesforce-feed.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Format, lint, typecheck, commit**

```bash
npm run format && npm run lint && npm run typecheck
git add lib/integrations/salesforce/collections.ts tests/integration/salesforce-feed.test.ts
git commit -F - <<'MSG'
Assignments, sessions, attendance, and GCF attempts, one table each

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 7: Registrations, computed from courses and enrollments

**Files:**
- Modify: `lib/integrations/salesforce/collections.ts`
- Modify: `tests/integration/salesforce-feed.test.ts` (append)

**Interfaces:**
- Consumes: `registrationRecord`, `registrationKey` from Task 4; `walk` from Task 1.
- Produces: the `registrations` entry in `COLLECTIONS`.

- [ ] **Step 1: Write the failing integration test**

Extend the records import in the test file to:

```ts
import { attendanceClassId, registrationKey } from "@/lib/integrations/salesforce/records";
```

Append inside the outer `describe`, after `gcf attempts`:

```ts
  describe("registrations", () => {
    let removedEnrollmentId: string;

    beforeAll(async () => {
      const removedStudentId = await makeAccount(tx());
      const removed = await enroll(tx(), {
        programId: world.programId,
        studentId: removedStudentId,
        status: "REMOVED",
      });
      removedEnrollmentId = removed.id;
    });

    it("pairs every published course with every enrollment in its program, removed included, test students excluded, nothing across programs", async () => {
      const records = await walkAll<Positioned & { classId: string; enrollmentId: string; enrollmentStatus: string }>(
        tx(),
        COLLECTIONS.registrations,
        2,
      );

      const expected = [
        registrationKey(world.courseId, world.students[0].id),
        registrationKey(world.courseId, world.students[1].id),
        registrationKey(world.courseId, removedEnrollmentId),
      ];
      const excluded = [
        registrationKey(world.courseId, testStudent.id),
        // The other program's course paired with this program's fellow: must not exist.
        registrationKey(otherCourseId, world.students[0].id),
      ];
      const seen = oursAmong(records, new Set([...expected, ...excluded]));

      expect(seen.sort()).toEqual(expected.sort());

      const removed = records.find(
        (record) => record.externalId === registrationKey(world.courseId, removedEnrollmentId),
      )!;
      expect(removed.enrollmentStatus).toBe("REMOVED");
      expect(removed.classId).toBe(world.courseId);
      expect(removed.enrollmentId).toBe(removedEnrollmentId);
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- tests/integration/salesforce-feed.test.ts`
Expected: FAIL — `registrations is not built yet`.

- [ ] **Step 3: Write the implementation**

Extend the records import in `collections.ts` to include `registrationRecord`. Add after `gcfAttempts`:

```ts
/**
 * A fellow in a course, for every published course and every enrollment in its program.
 *
 * No table holds this pair. The rule in this application is that being on a program's roster
 * makes somebody a student of every course of it (`lib/assignments/scope.ts`), so the pair is
 * formed here from the two tables that decide it. Both are small — a few hundred rows between
 * them — so loading them whole and walking the pairs in memory costs less than a query that could
 * express the join, and the cursor applies through `walk` exactly as it does in SQL elsewhere.
 *
 * Removed fellows keep their registrations: leaving a roster does not unmake the classes they sat
 * in, and their Assignment Submissions still name these. `enrollmentStatus` travels so a report on
 * the current roster can exclude them.
 */
const registrations: Collection = async (tx, query) => {
  const [courses, enrollmentRows] = await Promise.all([
    tx.course.findMany({
      where: { publishedAt: { not: null } },
      select: { id: true, programId: true, updatedAt: true },
    }),
    tx.enrollment.findMany({
      where: NOT_A_TEST_STUDENT,
      select: { id: true, programId: true, status: true, updatedAt: true },
    }),
  ]);

  const byProgram = new Map<string, typeof enrollmentRows>();
  for (const enrollment of enrollmentRows) {
    const list = byProgram.get(enrollment.programId) ?? [];
    list.push(enrollment);
    byProgram.set(enrollment.programId, list);
  }

  const records = courses.flatMap((course) =>
    (byProgram.get(course.programId) ?? []).map((enrollment) => registrationRecord(course, enrollment)),
  );

  return walk(records, query);
};
```

Replace `registrations: notBuiltYet("registrations"),` in `COLLECTIONS` with `registrations,`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- tests/integration/salesforce-feed.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Format, lint, typecheck, commit**

```bash
npm run format && npm run lint && npm run typecheck
git add lib/integrations/salesforce/collections.ts tests/integration/salesforce-feed.test.ts
git commit -F - <<'MSG'
Registrations are every course paired with every fellow in its program

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 8: The submissions grid

**Files:**
- Modify: `lib/integrations/salesforce/collections.ts`
- Modify: `tests/integration/salesforce-feed.test.ts` (append)

**Interfaces:**
- Consumes: `submissionRecord`, `submissionKey`, `type SubmissionRecord` from Task 4; `walk` from Task 1; `makeSubmission` from fixtures.
- Produces: the `submissions` entry in `COLLECTIONS`. `COLLECTIONS` no longer holds any `notBuiltYet` entry; delete that helper.

- [ ] **Step 1: Write the failing integration test**

Extend the records import in the test file to:

```ts
import { attendanceClassId, registrationKey, submissionKey } from "@/lib/integrations/salesforce/records";
```

and the fixtures import to include `makeSubmission`. Append inside the outer `describe`, after `registrations`:

```ts
  describe("the submissions grid", () => {
    let assignmentId: string;
    let removedEnrollment: { id: string; studentId: string };

    beforeAll(async () => {
      const assignment = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: world.unitId,
        kind: "REPO",
        pointValue: 40,
        dueAt: new Date("2026-02-01T05:00:00Z"),
      });
      assignmentId = assignment.id;

      // The first fellow has a released grade, handed in late; the second has never started.
      await makeSubmission(tx(), {
        assignmentId,
        studentId: world.students[0].studentId,
        submittedAt: new Date("2026-02-02T12:00:00Z"),
        graded: { score: 34, possible: 40, isComplete: true },
      });

      // A removed fellow with a real row: the row is sent, no notStarted is invented for them.
      const removedStudentId = await makeAccount(tx());
      const removed = await enroll(tx(), {
        programId: world.programId,
        studentId: removedStudentId,
        status: "REMOVED",
      });
      removedEnrollment = { id: removed.id, studentId: removedStudentId };
      await makeSubmission(tx(), { assignmentId, studentId: removedStudentId, status: "SUBMITTED" });

      // A second assignment the removed fellow never touched: no record for them at all.
      await makeAssignment(tx(), { courseId: world.courseId, courseUnitId: world.unitId, kind: "TASK" });
    });

    it("holds one record per active fellow per assignment, real rows for removed fellows, and nothing for the test student", async () => {
      const records = await walkAll<
        Positioned & {
          status: string;
          score: number | null;
          lateness: string | null;
          registrationId: string;
        }
      >(tx(), COLLECTIONS.submissions, 2);

      const graded = submissionKey(assignmentId, world.students[0].id);
      const unstarted = submissionKey(assignmentId, world.students[1].id);
      const removedReal = submissionKey(assignmentId, removedEnrollment.id);
      const ofTestStudent = submissionKey(assignmentId, testStudent.id);

      const seen = oursAmong(records, new Set([graded, unstarted, removedReal, ofTestStudent]));
      expect(seen.sort()).toEqual([graded, unstarted, removedReal].sort());

      const gradedRecord = records.find((record) => record.externalId === graded)!;
      expect(gradedRecord.status).toBe("graded");
      expect(gradedRecord.score).toBe(34);
      expect(gradedRecord.lateness).toBe("late");
      expect(gradedRecord.registrationId).toBe(registrationKey(world.courseId, world.students[0].id));

      const unstartedRecord = records.find((record) => record.externalId === unstarted)!;
      expect(unstartedRecord.status).toBe("notStarted");
      expect(unstartedRecord.score).toBeNull();
      expect(unstartedRecord.lateness).toBeNull();

      const removedRecord = records.find((record) => record.externalId === removedReal)!;
      expect(removedRecord.status).toBe("submitted");
    });

    it("invents no notStarted record for a removed fellow", async () => {
      const records = await walkAll(tx(), COLLECTIONS.submissions, 50);
      const forRemoved = records.filter((record) => record.externalId.endsWith(`:${removedEnrollment.id}`));
      // Exactly the one real row from the first assignment; nothing for the second.
      expect(forRemoved.map((record) => record.externalId)).toEqual([
        submissionKey(assignmentId, removedEnrollment.id),
      ]);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration -- tests/integration/salesforce-feed.test.ts`
Expected: FAIL — `submissions is not built yet`.

- [ ] **Step 3: Write the implementation**

Extend the records import in `collections.ts` to include `submissionRecord` and `type SubmissionRecord`. Add after `registrations`:

```ts
/**
 * One record per active fellow per distributed assignment, with the `submissions` row overlaid
 * where there is one.
 *
 * Salesforce has always held an Assignment Submission for every fellow on every assignment, and
 * reports there read a missing row as an error rather than as "not started". This keeps the grid
 * complete. A fellow has a `submissions` row only once they accept or hand in, so the pairs are
 * formed here from the assignments and the enrollments, and the rows are laid on top by
 * `(assignmentId, studentId)` — which is what `submissions` is unique on.
 *
 * **Every row is loaded, not only the changed ones.** A pair's synthesised record must be
 * replaced by its real row even when that row is old, or a page produced by an assignment's
 * `updatedAt` moving would say `notStarted` about somebody who was graded in February. At a few
 * thousand narrow rows that is milliseconds, and the day it is not, the answer is a materialised
 * table rather than a cleverer query.
 *
 * **Only active enrollments are synthesised.** A removed fellow's real rows are sent — the work
 * happened — but no `notStarted` is invented for assignments distributed after they left.
 */
const submissions: Collection = async (tx, query) => {
  const [assignmentRows, enrollmentRows, submissionRows] = await Promise.all([
    tx.assignment.findMany({
      where: { distributedAt: { not: null } },
      select: {
        id: true,
        courseId: true,
        dueAt: true,
        updatedAt: true,
        course: { select: { programId: true } },
      },
    }),
    tx.enrollment.findMany({
      where: NOT_A_TEST_STUDENT,
      select: { id: true, programId: true, studentId: true, status: true, updatedAt: true },
    }),
    tx.submission.findMany({
      where: { ...NOT_A_TEST_STUDENT, assignment: { distributedAt: { not: null } } },
      select: {
        assignmentId: true,
        studentId: true,
        status: true,
        submittedAt: true,
        finalScore: true,
        finalScorePossible: true,
        isComplete: true,
        gradedAt: true,
        feedbackMarkdown: true,
        extendedDueAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const activeByProgram = new Map<string, typeof enrollmentRows>();
  const enrollmentOf = new Map<string, (typeof enrollmentRows)[number]>();
  for (const enrollment of enrollmentRows) {
    enrollmentOf.set(`${enrollment.programId}:${enrollment.studentId}`, enrollment);
    if (enrollment.status !== "ACTIVE") continue;
    const list = activeByProgram.get(enrollment.programId) ?? [];
    list.push(enrollment);
    activeByProgram.set(enrollment.programId, list);
  }

  const records = new Map<string, SubmissionRecord>();

  for (const assignment of assignmentRows) {
    for (const enrollment of activeByProgram.get(assignment.course.programId) ?? []) {
      const record = submissionRecord({ assignment, enrollment }, null);
      records.set(record.externalId, record);
    }
  }

  const assignmentById = new Map(assignmentRows.map((assignment) => [assignment.id, assignment]));
  for (const row of submissionRows) {
    const assignment = assignmentById.get(row.assignmentId);
    if (!assignment) continue;
    const enrollment = enrollmentOf.get(`${assignment.course.programId}:${row.studentId}`);
    // A row for somebody not enrolled in the program cannot name a registration. Not reachable
    // through the application, which reaches every submission through an enrollment.
    if (!enrollment) continue;
    const record = submissionRecord({ assignment, enrollment }, row);
    records.set(record.externalId, record);
  }

  return walk([...records.values()], query);
};
```

Replace `submissions: notBuiltYet("submissions"),` with `submissions,` and delete the `notBuiltYet` helper, which nothing uses now.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:integration -- tests/integration/salesforce-feed.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Format, lint, typecheck, commit**

```bash
npm run format && npm run lint && npm run typecheck
git add lib/integrations/salesforce/collections.ts tests/integration/salesforce-feed.test.ts
git commit -F - <<'MSG'
The submissions grid is every fellow on every assignment, rows laid on top

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 9: The route, and the walk that proves exactly-once

**Files:**
- Create: `lib/integrations/salesforce/feed.ts`
- Create: `app/api/integrations/salesforce/[collection]/route.ts`
- Test: `tests/lib/integrations/salesforce/feed.test.ts`
- Modify: `tests/integration/salesforce-feed.test.ts` (append)

**Interfaces:**
- Consumes: `COLLECTIONS`, `isCollectionName` from Task 5; `parseFeedQuery`, `isFeedQueryError` from Task 1; `bearerTokenMatches` from Task 2; `db` from `@/lib/prisma`.
- Produces: `serveFeed(request: Request, collection: string): Promise<Response>`.

- [ ] **Step 1: Write the failing unit tests for the refusals**

Create `tests/lib/integrations/salesforce/feed.test.ts`:

```ts
import { serveFeed } from "@/lib/integrations/salesforce/feed";

/**
 * The three refusals, which need no database: they are decided before any query runs. The order
 * they are checked in is part of what is asserted — an unknown collection must not be
 * distinguishable from a known one to a caller without the token.
 */

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const URL_BASE = "https://lms.example.test/api/integrations/salesforce";

function request(path: string, authorization?: string): Request {
  return new Request(`${URL_BASE}/${path}`, {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("serveFeed refusals", () => {
  const previous = process.env.SALESFORCE_FEED_TOKEN;

  beforeEach(() => {
    process.env.SALESFORCE_FEED_TOKEN = TOKEN;
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.SALESFORCE_FEED_TOKEN;
    else process.env.SALESFORCE_FEED_TOKEN = previous;
  });

  it("is 401 without a token, with a wrong one, and when none is configured", async () => {
    expect((await serveFeed(request("programs"), "programs")).status).toBe(401);
    expect((await serveFeed(request("programs", "Bearer nope"), "programs")).status).toBe(401);

    delete process.env.SALESFORCE_FEED_TOKEN;
    expect((await serveFeed(request("programs", `Bearer ${TOKEN}`), "programs")).status).toBe(401);
  });

  it("is 401 rather than 404 for an unknown collection without the token", async () => {
    expect((await serveFeed(request("contacts"), "contacts")).status).toBe(401);
  });

  it("is 404 for an unknown collection with the token", async () => {
    const response = await serveFeed(request("contacts", `Bearer ${TOKEN}`), "contacts");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found\n");
  });

  it("is 400 for after without since", async () => {
    const response = await serveFeed(request("programs?after=b", `Bearer ${TOKEN}`), "programs");
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx jest tests/lib/integrations/salesforce/feed.test.ts`
Expected: FAIL — `Cannot find module '@/lib/integrations/salesforce/feed'`.

- [ ] **Step 3: Write `feed.ts` and the route**

Create `lib/integrations/salesforce/feed.ts`:

```ts
import "server-only";

import { db } from "@/lib/prisma";

import { COLLECTIONS, isCollectionName } from "./collections";
import { isFeedQueryError, parseFeedQuery } from "./cursor";
import { bearerTokenMatches } from "./token";

/**
 * One request to the Salesforce feed, from token to envelope.
 *
 * **Why a route handler and not a procedure.** Make.com calls this from its own servers on its
 * own schedule. It sends no cookie, it speaks no tRPC, and superjson's `{json, meta}` envelope is
 * one more thing it would have to unwrap. The calendar feed is a route for the same reasons.
 *
 * It is reachable without a session because `lib/supabase/proxy.ts` excludes `/api` from the
 * sign-in redirect for the GitHub webhook's sake, so a request with no cookie arrives here rather
 * than being answered with an HTML login page that Make would try to parse as JSON.
 *
 * **The token is checked before the collection name.** A 404 answered to a caller without the
 * token would tell them which names exist; every request without the token gets the same 401.
 *
 * **Refusals are one terse line.** There is nobody on the other end who would read a helpful
 * message — Make shows its operator a status code — and a message explaining which part was
 * wrong is a message that helps somebody probe the endpoint.
 *
 * **No rate limit.** A request runs one or two queries over small tables and returns at most 500
 * records. `lib/audit/rate-limit.ts` guards the operations that spend money at Anthropic and E2B;
 * this one spends a query.
 */
export async function serveFeed(request: Request, collection: string): Promise<Response> {
  const expected = process.env.SALESFORCE_FEED_TOKEN ?? "";
  if (!bearerTokenMatches(request.headers.get("authorization"), expected)) {
    return terse(401, "Unauthorized");
  }

  if (!isCollectionName(collection)) return terse(404, "Not found");

  const query = parseFeedQuery(new URL(request.url).searchParams);
  if (isFeedQueryError(query)) return terse(400, query.error);

  const page = await COLLECTIONS[collection](db, query);

  /*
    No caching anywhere. Make polls on its own schedule and there is no load to relieve, and a
    cached page would only add to the delay before a change reaches Salesforce.
  */
  return Response.json(page, { headers: { "Cache-Control": "no-store" } });
}

function terse(status: number, body: string): Response {
  return new Response(`${body}\n`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
```

Create `app/api/integrations/salesforce/[collection]/route.ts`:

```ts
import { serveFeed } from "@/lib/integrations/salesforce/feed";

/**
 * The Salesforce feed. Everything is in `lib/integrations/salesforce/feed.ts`; this file exists
 * because Next.js needs one here. `cacheComponents` is enabled, so `params` is a promise.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ collection: string }> },
): Promise<Response> {
  const { collection } = await params;
  return serveFeed(request, collection);
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx jest tests/lib/integrations/salesforce/feed.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing integration tests for exactly-once and the mid-walk update**

Append inside the outer `describe` in `tests/integration/salesforce-feed.test.ts`, after `the submissions grid`:

```ts
  describe("the walk itself", () => {
    it("returns every record of every collection exactly once at limit 1", async () => {
      for (const name of COLLECTION_NAMES) {
        const records = await walkAll(tx(), COLLECTIONS[name], 1);
        const ids = records.map((record) => record.externalId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it("returns a record again when it changes mid-walk, because its position moved past the cursor", async () => {
      // Page one at limit 1 is the earliest program; touch it so it moves to the end.
      const first = await COLLECTIONS.programs(tx(), { cursor: null, limit: 1 });
      const touched = first.records[0]!.externalId;
      await tx().program.update({ where: { id: touched }, data: { name: `Touched ${Date.now()}` } });

      // Continue from page one's cursor to the end.
      const rest: Positioned[] = [];
      let cursor: Cursor = first.hasMore
        ? { since: new Date(first.cursor!.since), after: first.cursor!.after }
        : null;
      while (cursor !== null) {
        const page = await COLLECTIONS.programs(tx(), { cursor, limit: 1 });
        rest.push(...page.records);
        cursor = page.hasMore ? { since: new Date(page.cursor!.since), after: page.cursor!.after } : null;
      }

      expect(rest.map((record) => record.externalId)).toContain(touched);
    });
  });
```

- [ ] **Step 6: Run the integration suite**

Run: `npm run test:integration -- tests/integration/salesforce-feed.test.ts`
Expected: PASS, 13 tests. (The two new tests exercise code from Tasks 5–8 and should pass on the first run; if the exactly-once test fails for one collection, the fault is in that collection's cursor handling, not here.)

- [ ] **Step 7: Format, lint, typecheck, run the whole unit suite, commit**

```bash
npm run format && npm run lint && npm run typecheck && npm test
git add lib/integrations/salesforce/feed.ts "app/api/integrations/salesforce/[collection]/route.ts" tests/lib/integrations/salesforce/feed.test.ts tests/integration/salesforce-feed.test.ts
git commit -F - <<'MSG'
The Salesforce feed answers at one route, token first and names second

Make.com reads nine collections through one token-protected route. The
token is checked before the collection name, so a caller without it learns
nothing about which names exist, and every refusal is one terse line.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md` (the environment variable table, around line 50)
- Modify: `ARCHITECTURE.md` (a new `## Salesforce feed` section before `## Test execution`)
- Modify: `ROADMAP.md` (the `## Salesforce synchronization` section)
- Modify: `docs/superpowers/specs/2026-09-22-salesforce-feed-design.md` (the file list under "The endpoints")

Per the writing rules: paragraphs are single unwrapped lines; a plan document states what is built, never what it replaced; do not touch the table of contents in ROADMAP.md.

- [ ] **Step 1: README — add the variable**

In the environment variable table in `README.md`, add a row after `GITHUB_WEBHOOK_PROXY_URL`:

```markdown
| `SALESFORCE_FEED_TOKEN`                                                                          | the bearer token Make.com presents to read the Salesforce feed               |
```

`npm run format` realigns the table.

- [ ] **Step 2: ARCHITECTURE — add the section**

Insert before the line `## Test execution` in `ARCHITECTURE.md`:

```markdown
## Salesforce feed

Marcy's system of record is Salesforce, and Make.com carries records there from here. This application's part is one read-only route, `GET /api/integrations/salesforce/{collection}`, serving nine collections that Make polls on a schedule and upserts into Salesforce by an External Id holding this application's identifier. The design is [the spec](docs/superpowers/specs/2026-09-22-salesforce-feed-design.md); what follows is where it lives.

- **`lib/integrations/salesforce/`** — `cursor.ts` parses `since`, `after`, and `limit`, and cuts a page after a `(updatedAt, externalId)` position; `token.ts` compares the bearer token over SHA-256 digests; `records.ts` spells the identifiers and maps a row to the flat record Make upserts; `collections.ts` holds the nine named queries; `feed.ts` turns a request into a response. The first three are pure and unit-tested; the last two touch the database and are covered by `tests/integration/salesforce-feed.test.ts`.
- **Change detection is `updatedAt`.** Every source table carries one that Prisma writes on every update, so no synchronization column exists and no write path has to remember to set one. Make sends back the position it reached; the collection returns what is strictly after it.
- **Two collections have no table.** Class Registrations are every published course paired with every enrollment in its program, by the rule in `lib/assignments/scope.ts`. Assignment Submissions are every active fellow on every distributed assignment, keyed `<assignmentId>:<enrollmentId>`, with the `submissions` row laid on top where there is one — so Salesforce holds a `notStarted` record before a fellow begins and the same record carries their grade afterwards.
- **Test students appear in no collection.** Every query that reaches a profile filters `testStudentNumber: null`.
- **One token, in `SALESFORCE_FEED_TOKEN`, checked before the collection name.** Unset, the route refuses everything. A refusal is one terse line, as the calendar feed's is.
```

- [ ] **Step 3: ROADMAP — rewrite the Salesforce section**

Replace everything from the line `## Salesforce synchronization` up to (not including) the `---` line that precedes `## Settled decisions and standing limits` with:

```markdown
## Salesforce synchronization

**Built: the feed.** This application serves nine collections over one token-protected route, and Make.com reads them and writes Salesforce. The design is [the spec](docs/superpowers/specs/2026-09-22-salesforce-feed-design.md), the code is `lib/integrations/salesforce/`, and [ARCHITECTURE.md](ARCHITECTURE.md#salesforce-feed) says how it is put together.

**What remains is configuration on two sides**, listed in full in the spec's last section. In Salesforce: an External Id field on each of ten objects — Contact, Program, and Program Enrollment among them, since those exist first and are stamped rather than created — the picklist spellings for submission status and assignment type, a nullable Max Score on Artifact with `kind` reportable, and a pass over the existing Flows and validation rules on the objects the feed writes. In Make: the setup scenario that matches Programs by name and term and Program Enrollments by fellow email, once, and stamps this application's identifiers onto them; and the sync scenario that walks the nine collections in dependency order from a stored cursor. Before the first run, the row counts, because Make bills per operation and the first walk is the whole history.

**Standing facts from the Salesforce side.** Marcy can create up to 30 developer sandboxes and a System Administrator can make one at any time; develop against a developer sandbox with invented data rather than the partial copy. The API ceiling is 127,000 calls per 24 hours, visible at Setup → System Overview, which is not a limit worth designing around at this volume. Make's Salesforce connection wants a dedicated integration user with a restricted profile, with permissions set at both object and field level.

**Coaching Conversations are the tenth collection**, added once the first nine are running: `coaching_sessions` under a Program Enrollment, behind a second token, because a note a fellow cannot read is more sensitive than a grade they can.

### Deferred: Salesforce

- **Stored Salesforce Ids.** The feed never needs one, and none is stored. What one would buy is a roster badge saying whether a fellow has reached Salesforce, and a link from a grade or an attendance record to the Salesforce record it became. If either is wanted, it is an addition: a nullable `salesforce_id` on the row-backed tables that want it, and a write endpoint Make posts each new record's Id back through. The External Id stays the mechanism; the stored Id is read only by the screen drawing the badge.
- **Dropping the dormant columns.** `submissions.salesforce_sync_status`, `salesforce_record_id`, and `salesforce_synced_at` are unread. `sharedAfterGrade`, `taskVerdict`, and `taskReset` still write the first, harmlessly. One migration removes all three, and it wants the schema deployed before the `DROP` for the same reason the legacy submission columns did.

```

- [ ] **Step 4: Spec — the file list**

In `docs/superpowers/specs/2026-09-22-salesforce-feed-design.md`, under `## The endpoints`, replace the two-line code block

```
app/api/integrations/salesforce/[collection]/route.ts
lib/integrations/salesforce/feed.ts
```

with

```
app/api/integrations/salesforce/[collection]/route.ts
lib/integrations/salesforce/feed.ts          — request to response
lib/integrations/salesforce/collections.ts   — the nine named queries
lib/integrations/salesforce/records.ts       — identifiers and row-to-record mappers
lib/integrations/salesforce/cursor.ts        — position, page, and the two walks
lib/integrations/salesforce/token.ts         — the bearer comparison
```

and change the sentence that follows, "The route handler checks the token, parses the cursor, looks the collection up in a table, runs its query, and writes the envelope. Each entry in that table holds a function producing ordered records after a cursor and nothing else. Authorization, cursor parsing, paging, the envelope, and error shapes are written once in `feed.ts`." to end "…are written once, in `feed.ts` and `cursor.ts`; the three pure modules are unit-tested on every save and the two that touch the database are covered by the integration suite."

- [ ] **Step 5: Format and commit**

```bash
npm run format && npm run format:check
git add README.md ARCHITECTURE.md ROADMAP.md docs/superpowers/specs/2026-09-22-salesforce-feed-design.md
git commit -F - <<'MSG'
The Salesforce feed is documented where each reader looks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

## After the last task

Everything below is Ben's to do; none of it is code.

1. `openssl rand -hex 32` → `SALESFORCE_FEED_TOKEN` in Vercel for the deployment environment and in `.env.local`. Deploy.
2. `curl -H "Authorization: Bearer $TOKEN" https://<host>/api/integrations/salesforce/programs` — expect 200 and a `records` array. Without the header — expect 401. `…/contacts` with the header — expect 404.
3. Follow `cursor` on `submissions` with `limit=500` to the end; confirm `hasMore` reaches false.
4. Run the row-count SQL from the spec against the deployment database and size Make's operation budget before any scenario runs.
5. In Salesforce: the External Id fields, the picklist spellings, the nullable Max Score. In Make: the setup scenario first, review its unmatched list, then the sync scenario with `limit=5` per collection before the backfill.
