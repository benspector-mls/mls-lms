import { languageForFence } from "@/lib/diff/languages";

/** One coloured run of a code block: its character range in the block, and its colours. */
export type TokenRange = { from: number; to: number; style: string };

/**
 * The coloured runs of one code block, for an editor to draw as decorations.
 *
 * Both editors — the formatted one and the Markdown box — colour code blocks the way rendered
 * Markdown does, with the one Shiki highlighter in `components/code-highlighter.ts`. What they
 * share is here: asking for the tokens, remembering the answer, and turning each token into a
 * range. Each editor then only finds its code blocks and draws the ranges in its own kind of
 * decoration, so the two cannot disagree about the colours.
 *
 * **Answered synchronously when it can be.** An editor rebuilds its decorations inside a
 * transaction, which cannot wait. So the answer is:
 * - the ranges, once they have been worked out for this exact text;
 * - null, when the fence names no language the highlighter colours, or the highlighter could not
 *   load (a browser without the ES2024 `v` regular expression flag), and the block stays plain;
 * - undefined while the tokens are still being fetched. `onReady` is called once they arrive, and
 *   the editor rebuilds then. Until it does, the editor keeps the colours it had, so typing in a
 *   block does not make it flash uncoloured.
 *
 * The style is the token's `--shiki-light` and `--shiki-dark` properties, which the `.shiki-token`
 * rules in `app/globals.css` turn into a colour for the current theme.
 */
export function codeTokenRanges(
  code: string,
  fence: string,
  onReady: () => void,
): TokenRange[] | null | undefined {
  const language = languageForFence(fence.trim().split(/\s/)[0] ?? "");
  if (language === null || code.length === 0) return null;

  const key = `${language}\n${code}`;
  if (answered.has(key)) return answered.get(key) ?? null;

  const waiting = pending.get(key);
  if (waiting) {
    // An editor asks again on every rebuild while it waits, and should be told only once.
    if (!waiting.includes(onReady)) waiting.push(onReady);
    return undefined;
  }
  pending.set(key, [onReady]);

  void (async () => {
    let ranges: TokenRange[] | null = null;
    try {
      const { highlightFileLines } = await import("@/components/code-highlighter");
      const lines = await highlightFileLines(code, language);
      ranges = lines.flatMap((tokens) =>
        (tokens ?? []).map((token) => ({
          from: token.offset,
          to: token.offset + token.content.length,
          style: Object.entries(token.htmlStyle ?? {})
            .map(([property, value]) => `${property}:${value}`)
            .join(";"),
        })),
      );
    } catch {
      ranges = null;
    }
    remember(key, ranges);
    const callbacks = pending.get(key) ?? [];
    pending.delete(key);
    for (const callback of callbacks) callback();
  })();

  return undefined;
}

/**
 * Answers already worked out, by language and text.
 *
 * Capped, because every keystroke in a code block is a new text, and an afternoon of writing
 * would otherwise keep every version of every block. A Map iterates in insertion order, so the
 * first key is the oldest.
 */
const answered = new Map<string, TokenRange[] | null>();
const ANSWERS_KEPT = 200;

/** Requests in flight, with every editor waiting on each, so one text is tokenized once. */
const pending = new Map<string, (() => void)[]>();

function remember(key: string, ranges: TokenRange[] | null) {
  answered.set(key, ranges);
  if (answered.size > ANSWERS_KEPT) {
    const oldest = answered.keys().next().value;
    if (oldest !== undefined) answered.delete(oldest);
  }
}
