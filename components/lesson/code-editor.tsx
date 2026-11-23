"use client";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import {
  codeFolding,
  defaultHighlightStyle,
  foldEffect,
  foldedRanges,
  foldGutter,
  foldService,
  syntaxHighlighting,
  unfoldEffect,
} from "@codemirror/language";
import { EditorState, type Extension, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  lineNumbers,
  WidgetType,
} from "@codemirror/view";
import * as React from "react";

import { cn } from "@/lib/utils";

export type EditorLanguage = "python" | "html" | "css" | "javascript";

const LANGUAGES = { python, html, css, javascript } as const;

/**
 * Code that runs before the fellow's, shown above it in the same box: read-only, folded to one
 * line until opened, and outside the line numbering, so a traceback's line 3 is the box's line 3.
 */
export type Prelude = { code: string; label: string };

/**
 * The box a fellow edits a runnable block's code in: CodeMirror, as the Markdown box is, with
 * line numbers, the language's colours, and Tab indenting the line. Controlled as a `textarea`
 * is: `value` and `onChange`, and a `value` the parent puts in, such as the author's code on
 * Reset, replaces what is in the box.
 *
 * With a `prelude`, the box holds the prelude's lines, a blank line, then `value`, in the order
 * the program runs. The prelude's lines cannot be edited, carry no line number, and start folded
 * under a heading that names them and opens or closes them; `value` and `onChange` still mean the
 * fellow's part alone.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  ariaLabel,
  prelude,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  language: EditorLanguage;
  ariaLabel: string;
  prelude?: Prelude;
  className?: string;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<EditorView | null>(null);
  const preludeCode = prelude?.code;
  const preludeLabel = prelude?.label;
  // The prelude, its newline, and the blank line after it; the fellow's code starts here.
  const protectedEnd = preludeCode === undefined ? 0 : preludeCode.length + 2;

  // The latest `onChange`, since the editor is built once and would otherwise keep the first.
  const callbacks = React.useRef({ onChange });
  React.useEffect(() => {
    callbacks.current = { onChange };
  });

  React.useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: preludeCode === undefined ? value : `${preludeCode}\n\n${value}`,
      extensions: [
        preludeCode === undefined || preludeLabel === undefined
          ? lineNumbers()
          : preludeExtensions(preludeCode, preludeLabel),
        history(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        LANGUAGES[language](),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            callbacks.current.onChange(update.state.doc.toString().slice(protectedEnd));
          }
        }),
        EditorView.theme({
          "&": { backgroundColor: "transparent", fontSize: "0.85em" },
          ".cm-content": { fontFamily: "var(--font-mono, ui-monospace, monospace)" },
          ".cm-gutters": {
            backgroundColor: "transparent",
            color: "var(--muted-foreground)",
            borderRight: "1px solid var(--border)",
          },
          "&.cm-focused": { outline: "none" },
        }),
      ],
    });
    const editor = new EditorView({ state, parent: host.current });
    if (preludeCode !== undefined) {
      editor.dispatch({ effects: foldEffect.of(preludeRange(preludeCode)) });
    }
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Built once: `value` is read at creation and then kept in step by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, ariaLabel, preludeCode, preludeLabel]);

  React.useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current.slice(protectedEnd) !== value) {
      // `filter: false`: the prelude's guard below stops the fellow's edits, not the parent's.
      editor.dispatch({
        changes: { from: protectedEnd, to: current.length, insert: value },
        filter: false,
      });
    }
  }, [value, protectedEnd]);

  return (
    <div
      ref={host}
      className={cn(
        "overflow-hidden rounded-md border border-border bg-muted/60 leading-relaxed",
        className,
      )}
    />
  );
}

/**
 * What folds: the prelude's lines and the line break after them, so that folded, the marker and
 * the blank line before the fellow's code share one line rather than taking two.
 */
function preludeRange(code: string): { from: number; to: number } {
  return { from: 0, to: code.length + 1 };
}

/**
 * The heading above a prelude: its label, and whether its lines are shown or folded away.
 *
 * The press is handled by the editor's own event handlers in `preludeExtensions`, the way
 * CodeMirror's documentation handles a widget that is pressed, rather than by a handler on the
 * element: the editor must see the press so that it can stop treating it as a click into the text.
 */
class PreludeHeading extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly lines: number,
    private readonly open: boolean,
  ) {
    super();
  }

  eq(other: PreludeHeading): boolean {
    return other.label === this.label && other.lines === this.lines && other.open === this.open;
  }

  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-prelude-heading";
    button.setAttribute("aria-expanded", String(this.open));
    button.textContent = `${this.open ? "▾" : "▸"} ${this.label} (${this.lines} ${
      this.lines === 1 ? "line" : "lines"
    })`;
    return button;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Whether the prelude's lines are folded away in this state. */
function preludeFolded(state: EditorState, range: { from: number; to: number }): boolean {
  let folded = false;
  foldedRanges(state).between(range.from, range.to, () => {
    folded = true;
  });
  return folded;
}

function togglePrelude(view: EditorView, range: { from: number; to: number }): void {
  const effect = preludeFolded(view.state, range) ? unfoldEffect : foldEffect;
  view.dispatch({ effects: effect.of(range) });
}

function isPreludeHeading(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".cm-prelude-heading") !== null;
}

/** The heading above the prelude, open or closed as the fold is, and a tint on its lines. */
function preludeDecorations(
  state: EditorState,
  label: string,
  lines: number,
  range: { from: number; to: number },
): DecorationSet {
  const heading = Decoration.widget({
    widget: new PreludeHeading(label, lines, !preludeFolded(state, range)),
    block: true,
    side: -1,
  }).range(0);
  const tinted = [];
  for (let line = 1; line <= lines; line += 1) {
    tinted.push(Decoration.line({ class: "cm-prelude-line" }).range(state.doc.line(line).from));
  }
  return Decoration.set([heading, ...tinted], true);
}

/**
 * What makes the first lines of the box a prelude: no edits there, no line numbers there and
 * the fellow's lines numbered from 1, a tint on its lines, a fold over them that the gutter and
 * the heading above them open and close, and the fold closed to start with.
 */
function preludeExtensions(code: string, label: string): Extension {
  const range = preludeRange(code);
  const lines = code.split("\n").length;
  // The prelude's lines and the blank line after them.
  const skipped = lines + 1;
  const protectedEnd = code.length + 2;

  return [
    lineNumbers({ formatNumber: (line) => (line <= skipped ? "" : String(line - skipped)) }),
    EditorState.changeFilter.of((transaction) => {
      let allowed = true;
      transaction.changes.iterChangedRanges((fromA) => {
        if (fromA < protectedEnd) allowed = false;
      });
      return allowed;
    }),
    foldService.of((_state, lineStart) => (lineStart === 0 ? range : null)),
    codeFolding(),
    foldGutter(),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (!isPreludeHeading(event.target)) return false;
        event.preventDefault();
        togglePrelude(view, range);
        return true;
      },
      keydown: (event, view) => {
        if (!isPreludeHeading(event.target) || (event.key !== "Enter" && event.key !== " ")) {
          return false;
        }
        event.preventDefault();
        togglePrelude(view, range);
        return true;
      },
    }),
    /*
      A state field rather than a computed set: a block widget may only come from one, since the
      editor lays out its lines before computed decorations are asked for.
    */
    StateField.define<DecorationSet>({
      create: (state) => preludeDecorations(state, label, lines, range),
      update: (current, transaction) => {
        const toggled = transaction.effects.some(
          (effect) =>
            (effect.is(foldEffect) || effect.is(unfoldEffect)) && effect.value.from === 0,
        );
        if (!toggled) return current.map(transaction.changes);
        return preludeDecorations(transaction.state, label, lines, range);
      },
      provide: (field) => EditorView.decorations.from(field),
    }),
    EditorView.theme({
      ".cm-prelude-heading": {
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "0.25rem 0.5rem",
        fontFamily: "var(--font-sans, ui-sans-serif, system-ui)",
        fontSize: "0.85em",
        color: "var(--muted-foreground)",
        backgroundColor: "var(--muted)",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
      },
      ".cm-prelude-line": { backgroundColor: "var(--muted)" },
      ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        border: "none",
        color: "var(--muted-foreground)",
        margin: "0",
      },
    }),
  ];
}
