/**
 * Searching a course's lessons: what the search procedure asks Postgres for, and how the snippets
 * it returns are drawn.
 *
 * Pure, so the page and the tests can both use it.
 */

/**
 * The text search configuration the stored `lesson_sections.search` column reads code with: English
 * stemming that keeps the stop words — `for`, `if`, `where`, `this` — that Postgres's own English
 * configuration leaves out. Headings and prose are read with the English configuration itself,
 * named as `'english'` beside this in the column and the query. See the migrations
 * `20261119120000_lesson_search_keeps_every_word` and `20261119180000_lesson_search_reads_code_apart`.
 */
export const SEARCH_CONFIG = "public.lesson_text";

/** How many sections a search returns. Past this many, a reader changes the words rather than scrolls. */
export const SEARCH_LIMIT = 20;

/**
 * The words of the languages the curriculum teaches that Postgres's English configuration treats as
 * too common to search for: Python's `and`, `as`, `for`, `from`, `if`, `in`, `is`, `not`, `or`,
 * `while` and `with`; SQL's `all`, `any`, `between`, `by`, `having`, `into`, `on`, `over`, `some`,
 * `then`, `when` and `where`; JavaScript's `do`, `of` and `this`; the test runners' `it`, `each`,
 * `before`, `after` and `only`; and a migration's `up` and `down`.
 *
 * Prose is indexed with English rules, so a query is read with them too, and those rules drop
 * these words — rightly for "for example", wrongly for `for` loops. In a query that has other
 * words, the ones listed here rank a section higher when its code holds any of them, so "how to
 * use a for loop" finds "use" and "loop" and puts the sections with `for` in their code first. In a
 * query with no other words, the listed ones must all be in a section's code.
 */
export const KEYWORDS_ENGLISH_DROPS = new Set([
  "after",
  "all",
  "and",
  "any",
  "as",
  "before",
  "between",
  "by",
  "do",
  "down",
  "each",
  "for",
  "from",
  "having",
  "if",
  "in",
  "into",
  "is",
  "it",
  "not",
  "of",
  "on",
  "only",
  "or",
  "over",
  "some",
  "then",
  "this",
  "up",
  "when",
  "where",
  "while",
  "with",
]);

/**
 * The listed keywords among a query's words. Split as Postgres splits words, at anything that is
 * not a letter, so `for_each` holds `for` and `each`.
 */
export function keywordsIn(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => KEYWORDS_ENGLISH_DROPS.has(word));
}

/** The longest query accepted. A search is a few words; this only refuses a pasted paragraph. */
export const MAX_SEARCH_LENGTH = 200;

/**
 * The characters `ts_headline` puts around each matched word in a snippet.
 *
 * Two rare brackets rather than HTML. The snippet is lesson text, which can hold a `<` of its own
 * ("when a < b"), so marking matches with `<mark>` and drawing the result as HTML would let the
 * lesson's text become markup. These are split back out into text and highlight by
 * `snippetParts`, and the page draws both as text.
 */
export const MATCH_START = "⟦";
export const MATCH_END = "⟧";

/** The options `ts_headline` is given: one fragment of about 12 to 30 words around the matches. */
export const HEADLINE_OPTIONS = `StartSel=${MATCH_START}, StopSel=${MATCH_END}, MaxFragments=1, MinWords=12, MaxWords=30`;

/** The options for a section's code: a short excerpt around the matches. */
export const CODE_OPTIONS = `StartSel=${MATCH_START}, StopSel=${MATCH_END}, MaxFragments=1, MinWords=3, MaxWords=12`;

/**
 * The options for a section's heading: every matched word marked, and the whole heading kept. A
 * section can match through its heading alone, and the reader should see why it was listed.
 */
export const HEADING_OPTIONS = `StartSel=${MATCH_START}, StopSel=${MATCH_END}, HighlightAll=true`;

/** A snippet or heading as runs of plain text and matched words, in order. */
export function snippetParts(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let rest = snippet;

  while (rest.length > 0) {
    const start = rest.indexOf(MATCH_START);
    const end = start === -1 ? -1 : rest.indexOf(MATCH_END, start + MATCH_START.length);
    if (start === -1 || end === -1) {
      parts.push({
        text: rest.replaceAll(MATCH_START, "").replaceAll(MATCH_END, ""),
        match: false,
      });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), match: false });
    parts.push({ text: rest.slice(start + MATCH_START.length, end), match: true });
    rest = rest.slice(end + MATCH_END.length);
  }

  return parts.filter((part) => part.text !== "");
}
