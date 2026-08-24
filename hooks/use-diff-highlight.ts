"use client";

import type { ThemedToken } from "@shikijs/core";
import * as React from "react";

import type { DiffLanguage } from "@/lib/diff/languages";
import type { DiffHunk } from "@/lib/diff/patch";

/**
 * Syntax colours for one file's diff, or null until there are any.
 *
 * **Requested only once a file has been opened**, which is what keeps the cost proportionate to
 * what is read: a forty-file diff where an instructor expands three loads the grammars for those
 * three, and a screen with no diff on it loads no highlighter at all. `hunks` being null is how a
 * closed card says "not yet".
 *
 * Null is also the answer when there is no grammar for this language, and when the highlighter
 * could not be loaded. Both render the same way — plain monospace with the added and removed lines
 * tinted — which is a perfectly readable diff, so neither is an error state. The failure that
 * makes the second case real is a browser too old for the ES2024 `v` regular expression flag,
 * where the grammar modules throw as they evaluate.
 *
 * Nothing moves when the tokens arrive: the same rows, with the same text, gaining colour.
 */
export function useDiffHighlight(
  hunks: DiffHunk[] | null,
  language: DiffLanguage | null,
): (ThemedToken[] | null)[] | null {
  const [tokens, setTokens] = React.useState<(ThemedToken[] | null)[] | null>(null);

  React.useEffect(() => {
    if (!hunks || hunks.length === 0 || language === null) {
      setTokens(null);
      return;
    }

    // Guards against a card closed, or a queue moved on to the next student, while a grammar was
    // still being fetched — at which point this component's tokens are nobody's.
    let active = true;

    void (async () => {
      try {
        const { highlightDiffLines } = await import("@/components/code-highlighter");
        const next = await highlightDiffLines(hunks, language);
        if (active) setTokens(next);
      } catch {
        // Deliberately silent, and deliberately not a message on the screen. The reader still has
        // the diff; what they do not have is colour in it, which is not a thing to interrupt
        // somebody writing feedback about.
        if (active) setTokens(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [hunks, language]);

  return tokens;
}
