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
 * every page forever. No collection reads such a column. `lib/courses/order.ts` writes
 * `updated_at = now()` in raw SQL for the tables in its `SEQUENCES`, none of which the feed reads —
 * adding one would break this, and a note there says so. The integration suite's walk at `limit=1`
 * is what would notice.
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
    cursor:
      hasMore && last ? { since: last.updatedAt.toISOString(), after: last.externalId } : null,
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
):
  | { OR: [{ updatedAt: { gt: Date } }, { updatedAt: Date; id: { gt: string } }] }
  | Record<string, never> {
  if (cursor === null) return {};
  return {
    OR: [
      { updatedAt: { gt: cursor.since } },
      { updatedAt: cursor.since, id: { gt: cursor.after } },
    ],
  };
}
