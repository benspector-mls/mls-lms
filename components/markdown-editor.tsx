"use client";

import * as React from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  markdownLanguage,
} from "@codemirror/lang-markdown";
import { HighlightStyle, LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { cn } from "@/lib/utils";

/**
 * A box for writing markdown that shows the formatting as it is typed.
 *
 * **Why an editor and not a `textarea`.** A `textarea` holds plain text only, so nothing inside one
 * can be drawn bold. This is CodeMirror, which draws the text itself: `**bold**` shows bold,
 * `*italic*` shows italic, and `` `code` `` shows as code, with the asterisks and backticks left in
 * place and faded. The markdown is still what is stored, character for character — the styling is
 * only how it is drawn — so what a fellow reads is exactly what was typed.
 *
 * **What the keys do.**
 * - Tab indents the line and Shift+Tab outdents it.
 * - Escape and then Tab, within two seconds, moves to the next field instead, so a keyboard user is
 *   never trapped in the box. Ctrl+M (Shift+Alt+M on a Mac) turns that on until it is pressed
 *   again. Both are CodeMirror's own.
 * - Enter on a list item starts the next item, numbered lists counting up, and Enter on an empty
 *   item ends the list.
 * - Ctrl+Z and Cmd+Z undo, including an indent or an item the editor added; the history is
 *   CodeMirror's, which records every change it makes.
 * - Ctrl+Enter and Cmd+Enter are left alone, so the form around the box can use them to send.
 *
 * Beneath the box, a line says that it takes Markdown and links to the curriculum's guide.
 *
 * **Controlled, with one exception.** `value` and `onChange` behave as they do on a `textarea`. The
 * settings that build the editor — `placeholder`, `maxLength`, `id`, `ariaLabel`, `autoFocus` — are
 * read once, when it is created, because recreating it would throw away the cursor and the undo
 * history; no caller changes them while the box is open.
 */
export function MarkdownEditor({
  value,
  onChange,
  id,
  ariaLabel,
  placeholder,
  rows = 3,
  maxLength,
  autoFocus,
  disabled,
  onKeyDown,
  className,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  /** On the editable element, so a caller can find it the way it would find a `textarea`. */
  id?: string;
  /**
   * The editable element's accessible name. A `<label htmlFor>` names only form elements, and this
   * is not one, so a box with a visible label passes the label's words here as well.
   */
  ariaLabel?: string;
  placeholder?: string;
  /** The height the empty box is drawn at, in lines, as `rows` sets it on a `textarea`. */
  rows?: number;
  /** Edits that would make the text longer than this are refused, as a `textarea` refuses them. */
  maxLength?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Keys the editor did not take, bubbling from inside it — Ctrl+Enter is the one callers want. */
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  className?: string;
  ref?: React.Ref<{ focus: () => void }>;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<EditorView | null>(null);
  const editable = React.useRef(new Compartment());

  /*
    The latest `onChange`, read by the editor's listener. The editor is built once, so a listener
    that closed over the first render's `onChange` would keep calling it after the parent had
    moved on to a newer one.
  */
  const callbacks = React.useRef({ onChange });
  React.useEffect(() => {
    callbacks.current = { onChange };
  });

  React.useImperativeHandle(ref, () => ({ focus: () => view.current?.focus() }), []);

  React.useEffect(() => {
    if (!host.current) return;

    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          /*
            First, so these win: Enter continues a list and Backspace at the start of an item
            removes its marker, before the default Enter and Backspace see the key.
          */
          keymap.of([
            { key: "Enter", run: insertNewlineContinueMarkup },
            { key: "Backspace", run: deleteMarkupBackward },
            indentWithTab,
            ...historyKeymap,
            // The default inserts a blank line; the form around the box sends on it instead.
            ...defaultKeymap.filter((binding) => binding.key !== "Mod-Enter"),
          ]),
          /*
            The GitHub dialect, because that is what the renderer reads (`remark-gfm`), so a table
            or a struck-through word is recognised here the way it will be drawn there. Without the
            `markdown()` wrapper, which would also bring in the HTML, CSS and JavaScript languages
            for code inside the markdown, and the weight of all three, to colour nothing.
          */
          new LanguageSupport(markdownLanguage),
          syntaxHighlighting(markdownStyle),
          editorTheme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            ...(id ? { id } : {}),
            ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
          }),
          ...(placeholder ? [placeholderText(placeholder)] : []),
          ...(maxLength === undefined
            ? []
            : [
                EditorState.transactionFilter.of((tr) =>
                  tr.docChanged && tr.newDoc.length > maxLength ? [] : tr,
                ),
              ]),
          editable.current.of(EditorView.editable.of(!disabled)),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((tr) => tr.annotation(fromProps))
            ) {
              callbacks.current.onChange(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = created;
    if (autoFocus) created.focus();

    return () => {
      created.destroy();
      view.current = null;
    };
    // Built once: see "Controlled, with one exception" above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    A value the parent changed on its own — a reset, a cleared box after sending — written into the
    editor. Marked, so the listener above does not hand it straight back as though it were typed.
  */
  React.useEffect(() => {
    const current = view.current;
    if (!current) return;
    const text = current.state.doc.toString();
    if (text === value) return;
    current.dispatch({
      changes: { from: 0, to: text.length, insert: value },
      annotations: fromProps.of(true),
    });
  }, [value]);

  React.useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure(EditorView.editable.of(!disabled)),
    });
  }, [disabled]);

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div
        ref={host}
        onKeyDown={onKeyDown}
        // The empty box's height, held before the editor arrives so the page does not jump.
        style={{ minHeight: `calc(${rows} * 1.5em + 1rem + 2px)` }}
        className={cn(
          // The same box `Textarea` draws, so the two read as one kind of field.
          "flex w-full flex-col overflow-hidden rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-normal transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:text-sm dark:bg-input/30",
          disabled && "cursor-not-allowed bg-input/50 opacity-50 dark:bg-input/80",
          className,
        )}
      />
      {/*
        Under every box rather than chosen per field, so nobody meets a markdown box without being
        told what it takes and where to learn it. A new tab, because leaving this page in the same
        tab would throw away whatever had been written in the box.
      */}
      <p className="text-xs text-muted-foreground">
        This field accepts Markdown. For help writing it, see the{" "}
        <a
          href={MARKDOWN_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Markdown guide
        </a>
        .
      </p>
    </div>
  );
}

/** The curriculum's own guide, so the help matches what fellows are taught. */
const MARKDOWN_GUIDE_URL = "https://marcylabschool.gitbook.io/swe/how-tos/how-to-write-markdown";

/** Marks a change that came from the `value` prop rather than from typing. */
const fromProps = Annotation.define<boolean>();

/**
 * The editor drawn as a plain field: the font, size and line height of the box around it, no outline
 * of its own (the box has the focus ring), and the browser's own caret and selection, which follow
 * light and dark mode without being told.
 *
 * The editor is a flex child of the box that may grow and may shrink. Growing fills the box's
 * minimum height, so a click anywhere in an empty box lands in the editor; shrinking is what lets a
 * caller cap the box with a class such as `max-h-[35vh]` and have the text scroll inside the cap.
 */
const editorTheme = EditorView.theme({
  "&": { fontSize: "inherit", flex: "1 1 auto", minHeight: "0" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit", overflow: "auto" },
  ".cm-content": { padding: "0", caretColor: "currentColor" },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
});

/**
 * What the formatting looks like while it is typed. The markers themselves — the asterisks,
 * backticks and hashes — are faded rather than hidden, so the text on screen is still exactly the
 * text that is stored and an instructor can see where a bold run ends.
 */
const markdownStyle = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: tags.monospace,
    fontFamily: "var(--font-mono)",
    backgroundColor: "var(--muted)",
    borderRadius: "0.25rem",
  },
  {
    tag: [
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6,
    ],
    fontWeight: "700",
  },
  { tag: tags.processingInstruction, color: "var(--muted-foreground)" },
]);
