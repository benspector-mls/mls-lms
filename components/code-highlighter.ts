import type { ThemedToken } from "@shikijs/core";

import type { DiffHunk } from "@/lib/diff/patch";
import type { DiffLanguage } from "@/lib/diff/languages";

/**
 * Syntax colours for code, in the browser — for a pull request's diff and for an uploaded file.
 *
 * **One module for both, because the highlighter and the set of grammars already fetched are
 * module-level state.** A second module would build a second highlighter and download the same
 * grammar again, so a screen showing a Python upload beside a Python diff would pay twice for
 * one language. It sits outside `components/instructor/` because an uploaded file is shown to the
 * student who handed it in as well as to the instructor reading it.
 *
 * **In the browser and not on the server, because tokens are far larger than the text they
 * describe.** A themed token is about ninety bytes of JSON carrying a few characters, and there
 * are half a dozen per line, so a nine-hundred-line diff whose patch text is forty kilobytes
 * becomes about five hundred kilobytes of tokens — with no cache anywhere in this application to
 * spread that cost over, and a megabyte of grammars added to a function bundle that every other
 * procedure in the deployment would then carry. Here it is a dynamic import, on one screen, for
 * the languages that screen actually needs.
 *
 * **Measured from this repository's own production build**, gzipped: the core, the engine and the
 * two themes come to 28kB in one chunk, and each grammar is a chunk of its own — 17kB for
 * TypeScript, 9kB for Python, 8kB for SQL, 6kB for Markdown. So reading a TypeScript diff costs
 * about 45kB, none of it on any other screen and none of it in the shared bundle. Re-measure by
 * looking for the chunks that mention `shiki` after `npm run build`.
 *
 * The pieces rather than the `shiki` meta package, and the same call `lib/github/app-client.ts`
 * makes about Octokit: take what is used. The precompiled grammars ship their patterns as regular
 * expression literals, so `createJavaScriptRawEngine` runs them directly and there is no WebAssembly
 * asset to serve and no translation step at load. The cost is that those literals use the ES2024
 * `v` flag, so a browser older than Chrome 112, Safari 17 or Firefox 116 fails to evaluate the
 * module — which `useDiffHighlight` catches, leaving the diff in plain monospace. Unhighlighted
 * code is a perfectly good diff; a blank card is not.
 */

/**
 * One loader per language, and never a static import of all of them.
 *
 * `satisfies` is the point: a language added to `DiffLanguage` with no loader here fails to
 * compile, rather than silently rendering plain while a grammar for it sits unused in the bundle.
 */
const GRAMMARS = {
  typescript: () => import("@shikijs/langs-precompiled/typescript"),
  tsx: () => import("@shikijs/langs-precompiled/tsx"),
  javascript: () => import("@shikijs/langs-precompiled/javascript"),
  jsx: () => import("@shikijs/langs-precompiled/jsx"),
  json: () => import("@shikijs/langs-precompiled/json"),
  css: () => import("@shikijs/langs-precompiled/css"),
  html: () => import("@shikijs/langs-precompiled/html"),
  markdown: () => import("@shikijs/langs-precompiled/markdown"),
  sql: () => import("@shikijs/langs-precompiled/sql"),
  shellscript: () => import("@shikijs/langs-precompiled/shellscript"),
  python: () => import("@shikijs/langs-precompiled/python"),
} satisfies Record<DiffLanguage, () => Promise<unknown>>;

/** One highlighter for the page, created on the first file anybody expands. */
let highlighterPromise: Promise<Awaited<ReturnType<typeof create>>> | null = null;
const loaded = new Set<DiffLanguage>();

/**
 * The highlighter, with this language's grammar fetched.
 *
 * Both entry points go through here, so a grammar is downloaded once however it is first asked
 * for — a Python upload read beside a Python diff pays for one.
 */
async function withLanguage(language: DiffLanguage) {
  highlighterPromise ??= create();
  const highlighter = await highlighterPromise;

  if (!loaded.has(language)) {
    const grammar = await GRAMMARS[language]();
    await highlighter.loadLanguage((grammar as { default: never }).default);
    loaded.add(language);
  }

  return highlighter;
}

async function create() {
  const [{ createHighlighterCore }, { createJavaScriptRawEngine }, light, dark] = await Promise.all(
    [
      import("@shikijs/core"),
      import("@shikijs/engine-javascript"),
      import("@shikijs/themes/github-light"),
      import("@shikijs/themes/github-dark"),
    ],
  );

  return createHighlighterCore({
    themes: [light.default, dark.default],
    // None up front. Each is fetched by `GRAMMARS` when a file that needs it is opened.
    langs: [],
    engine: createJavaScriptRawEngine(),
  });
}

/**
 * Tokens for every line of one file's diff, in the order the lines are rendered.
 *
 * **Two passes over two coherent texts, rather than one over the patch.** A diff interleaves two
 * versions of the same region: a removed line reading `const label = \`a` followed by an added line
 * reading `const label = \`b` is one line in two states, and handing a grammar both at once gives
 * it a text that never existed — an unterminated template literal that mis-colours everything
 * after it. So the base text is built from the context and removed lines, the head text from the
 * context and added ones, and each is tokenized on its own. Removed lines take their colours from
 * the first pass and added and context lines from the second.
 *
 * **One pass per side rather than one per hunk**, because a hunk boundary is a gap in the file and
 * restarting the grammar at each `@@` would mis-colour a block comment that opens in one hunk and
 * closes in a later one. Joining the hunks is still an approximation — the regions are not
 * adjacent — but it is the better one, and it is the approximation GitHub itself makes. The exact
 * answer is to fetch each whole file at the head commit, which is one request per file and too
 * much for a browser to do by default.
 */
export async function highlightDiffLines(
  hunks: DiffHunk[],
  language: DiffLanguage,
): Promise<(ThemedToken[] | null)[]> {
  const highlighter = await withLanguage(language);

  /*
    Which rendered line each side's text came from, recorded on the way, so mapping the tokens
    back afterwards is an index lookup rather than a second walk that has to agree with this one.
  */
  const flat = hunks.flatMap((hunk) => hunk.lines);
  const base: string[] = [];
  const head: string[] = [];
  const source = flat.map((line) => {
    // The carriage return goes to the renderer, not to the grammar: a lone `\r` inside a string
    // literal is not something a TextMate grammar has an opinion worth having about.
    const text = line.text.endsWith("\r") ? line.text.slice(0, -1) : line.text;
    if (line.kind === "remove") return { side: "base" as const, index: base.push(text) - 1 };
    if (line.kind === "add") return { side: "head" as const, index: head.push(text) - 1 };
    // A context line is the same text on both sides; taking it consistently from one is what
    // matters, and the head side is the version the instructor is reading.
    base.push(text);
    return { side: "head" as const, index: head.push(text) - 1 };
  });

  const options = themeOptions(language);

  const tokensBySide = {
    base: base.length > 0 ? highlighter.codeToTokens(base.join("\n"), options).tokens : [],
    head: head.length > 0 ? highlighter.codeToTokens(head.join("\n"), options).tokens : [],
  };

  return source.map(({ side, index }) => tokensBySide[side][index] ?? null);
}

/**
 * The options both entry points tokenize with.
 *
 * `defaultColor: false` is the part that matters: it puts the colour in the two custom properties
 * `--shiki-light` and `--shiki-dark` rather than baking one theme into the markup, which is what
 * lets the three rules on `.shiki-code` in `app/globals.css` decide which theme is painted.
 */
function themeOptions(language: DiffLanguage) {
  return {
    lang: language,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  } as const;
}

/**
 * Tokens for every line of one whole file, in order.
 *
 * The counterpart to `highlightDiffLines`, and much the simpler of the two: a file is a text that
 * exists, so it is tokenized in one pass and needs none of the base-and-head reconstruction a
 * diff needs to avoid handing a grammar two versions of the same line at once.
 *
 * The returned array is one entry per line of `text` split on newlines, which is the same
 * splitting the caller renders by — `codeToTokens` returns one token list per line — so mapping a
 * rendered row to its colours is an index lookup.
 */
export async function highlightFileLines(
  text: string,
  language: DiffLanguage,
): Promise<(ThemedToken[] | null)[]> {
  const highlighter = await withLanguage(language);

  return highlighter.codeToTokens(text, themeOptions(language)).tokens;
}
