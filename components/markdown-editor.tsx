"use client";

import { Type } from "lucide-react";
import dynamic from "next/dynamic";
import * as React from "react";

import { MarkdownSourceEditor } from "@/components/markdown-source-editor";
import { Button } from "@/components/ui/button";
import { formattedEditorWouldChange } from "@/lib/markdown/formatted-editor";
import { cn } from "@/lib/utils";

/*
  Loaded in the browser only. Tiptap's React binding draws random ids while it renders, and Next.js
  refuses a random value in a page it prerenders, which failed the build on the New rubric page. The
  editor has nothing to show before the browser has it, so the server renders the empty box instead.
*/
const RichMarkdownEditor = dynamic(
  () => import("@/components/rich-markdown-editor").then((module) => module.RichMarkdownEditor),
  { ssr: false, loading: () => <div className="min-h-24 rounded-lg border border-input" /> },
);

/**
 * Every box in the application where someone writes Markdown.
 *
 * **Formatted text first, the Markdown itself one button away.** The box opens as
 * `RichMarkdownEditor`, which shows headings, lists, tables and code as themselves, so nobody has
 * to know Markdown syntax to write feedback or a comment. "Edit as Markdown" on its toolbar
 * switches to `MarkdownSourceEditor`, the syntax itself, for anything the formatted editor cannot
 * show and for whoever would rather type it; "Edit as formatted text" switches back. Both edit the
 * same `value`, so nothing typed in one is lost in the other.
 *
 * **Text the formatted editor would damage opens as Markdown**, and stays there while it still
 * holds what would be damaged: HTML other than `<br>`, which the formatted editor deletes, and code
 * inside a numbered list, which it indents further on every save. See
 * `formattedEditorWouldChange`. Checked when the box opens and whenever the parent puts in text of
 * its own — a rule set copied in by "Start from", a review row restored by Undo — but never against
 * what was typed in the box, so that a box someone is typing in never switches under them.
 *
 * **There is no separate preview.** The formatted editor already draws the text the way it will
 * be read, which is what each box's Preview switch used to be for.
 *
 * **Keys.** `onKeyDown` sits on a wrapper around whichever editor is showing, so a key either
 * editor does not take — Ctrl+Enter, which forms use to send — reaches it from both.
 *
 * `maxLength` limits only the Markdown box, which refuses an edit past it. The formatted editor
 * leaves the limit to the server, which refuses a save that is too long.
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
  initialPoint,
  disabled,
  onKeyDown,
  className,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  /** On the editable element, so a `<label htmlFor>` can name it and a caller can find it. */
  id?: string;
  /** The editable element's accessible name, since neither editor is a form element. */
  ariaLabel?: string;
  placeholder?: string;
  /** The height the empty box is drawn at, in lines, as `rows` sets it on a `textarea`. */
  rows?: number;
  maxLength?: number;
  autoFocus?: boolean;
  /** Where the caret starts in the formatted editor; see `RichMarkdownEditor`. */
  initialPoint?: { x: number; y: number };
  disabled?: boolean;
  /** Keys neither editor took, bubbling from inside it — Ctrl+Enter is the one callers want. */
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  /** The box's classes, such as a `max-h-*` cap. The Markdown box is always monospace. */
  className?: string;
  ref?: React.Ref<{ focus: () => void }>;
}) {
  const [editingMarkdown, setEditingMarkdown] = React.useState(() =>
    formattedEditorWouldChange(value),
  );
  const kept = editingMarkdown && formattedEditorWouldChange(value);

  /*
    The last text this box sent up. A `value` that differs from it came from the parent, and is
    the only kind checked after the box has opened.
  */
  const sent = React.useRef(value);
  const send = (next: string) => {
    sent.current = next;
    onChange(next);
  };
  React.useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    if (formattedEditorWouldChange(value)) setEditingMarkdown(true);
  }, [value]);
  /** Whether either button has been pressed, after which the editor that appears takes focus. */
  const [switched, setSwitched] = React.useState(false);

  return (
    <div onKeyDown={onKeyDown} className="flex w-full flex-col gap-1.5">
      {editingMarkdown ? (
        <>
          {kept ? (
            <p className="text-xs text-muted-foreground">
              Edited as Markdown, because this text has HTML or code inside a numbered list, which
              the formatted editor would change.
            </p>
          ) : (
            <div className="flex justify-end">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setSwitched(true);
                  setEditingMarkdown(false);
                }}
              >
                <Type data-icon="inline-start" />
                Edit as formatted text
              </Button>
            </div>
          )}
          <MarkdownSourceEditor
            ref={ref}
            value={value}
            onChange={send}
            id={id}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            rows={rows}
            maxLength={maxLength}
            // Focused after a switch, because the instructor pressed the button to type here.
            autoFocus={autoFocus || switched}
            disabled={disabled}
            className={cn("font-mono", className)}
          />
        </>
      ) : (
        <RichMarkdownEditor
          ref={ref}
          value={value}
          onChange={send}
          id={id}
          ariaLabel={ariaLabel}
          placeholder={placeholder}
          rows={rows}
          autoFocus={autoFocus || switched}
          initialPoint={initialPoint}
          disabled={disabled}
          onEditAsMarkdown={() => {
            setSwitched(true);
            setEditingMarkdown(true);
          }}
          className={className}
        />
      )}
    </div>
  );
}
