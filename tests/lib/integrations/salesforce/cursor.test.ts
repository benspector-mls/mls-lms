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
  type Page,
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
    expect(isFeedQueryError(parseFeedQuery(new URLSearchParams({ since: "yesterday" })))).toBe(
      true,
    );
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
      const page: Page<Positioned> = walk(items, { cursor, limit: 2 });
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

  it("asks only by instant when since arrived without after", () => {
    /*
      `after` is the empty string here, and every identifier sorts after it — so the pair reduces
      to "at or after this instant". Spelling it that way matters: the other branch compares the
      cursor against `id`, and `id` is a uuid column in Postgres, which cannot be compared with an
      empty string. Emitting that comparison makes the query throw rather than return nothing.
    */
    expect(cursorWhere({ since: T0, after: "" })).toEqual({ updatedAt: { gte: T0 } });
  });

  it("asks for a later instant, or the same instant and a greater id", () => {
    expect(cursorWhere({ since: T0, after: "b" })).toEqual({
      OR: [{ updatedAt: { gt: T0 } }, { updatedAt: T0, id: { gt: "b" } }],
    });
  });
});
