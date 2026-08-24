"use client";

import type { ThemedToken } from "@shikijs/core";
import * as React from "react";

import type { DiffLanguage } from "@/lib/diff/languages";

/**
 * Syntax colours for one whole file, or null until there are any.
 *
 * A sibling of `useDiffHighlight` rather than a widening of it, because the two take different
 * inputs — hunks against a text — and one function taking either would spend its body deciding
 * which it got. Everything else about them is the same, deliberately: the grammar is a dynamic
 * import so no screen without code on it pays for one, an `active` flag guards against a view
 * closed while a grammar was still being fetched, and any failure falls back to plain monospace
 * in silence.
 *
 * **Null is not an error state and never becomes one.** It is the answer before the tokens
 * arrive, the answer for a file with no grammar, and the answer when the highlighter could not
 * load at all — which happens on a browser too old for the ES2024 `v` regular expression flag the
 * precompiled grammars use. Uncoloured code is perfectly readable code; a message saying the
 * colours failed is an interruption to somebody writing feedback.
 */
export function useFileHighlight(
  text: string | null,
  language: DiffLanguage | null,
): (ThemedToken[] | null)[] | null {
  const [tokens, setTokens] = React.useState<(ThemedToken[] | null)[] | null>(null);

  React.useEffect(() => {
    if (text === null || text.length === 0 || language === null) {
      setTokens(null);
      return;
    }

    let active = true;

    void (async () => {
      try {
        const { highlightFileLines } = await import("@/components/code-highlighter");
        const next = await highlightFileLines(text, language);
        if (active) setTokens(next);
      } catch {
        if (active) setTokens(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [text, language]);

  return tokens;
}
