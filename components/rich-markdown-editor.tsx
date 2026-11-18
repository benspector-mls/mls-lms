"use client";

import * as React from "react";
import { Extension } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { TableCell, TableHeader, TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  FileCode,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Redo2,
  SquareCode,
  Table,
  Undo2,
} from "lucide-react";

import { CodeBlockWithLanguage } from "@/components/rich-markdown-code-block";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A box that shows markdown as formatted text — headings, lists and tables drawn as themselves —
 * and hands back markdown.
 *
 * **Why not the Markdown box alone.** Writing Markdown means knowing its syntax, and a markdown
 * table is a grid of pipes that has to be kept lined up by hand: adding a column means editing
 * every row. Here a heading is a heading and a table is a table, with buttons to add and remove
 * rows and columns, and the markdown is written when the text is read out. Tiptap is the editor;
 * its Markdown extension reads and writes GitHub-flavoured markdown, which is what the renderer
 * and the model read. `MarkdownEditor` offers this first and the Markdown box as the alternative.
 *
 * **Several lines in one table cell.** Markdown keeps a table cell on one line, so a line break
 * inside a cell is written as `<br>` and read back as a line break. The ported coding rubric
 * already lists its band descriptions that way, so it opens with each item on its own line.
 *
 * **Opening and saving without an edit hands back the text it was given.** Tiptap writes markdown
 * in its own style — `\_` for an underscore, `*` for italics, a blank line before a table — so
 * reading out text that nobody touched can still differ from what was stored. Saving that would
 * create a new rubric version that changes nothing. So the reformatted text is recorded when the
 * editor opens, and while the content still reads out as that, `onChange` is given the original
 * instead. An edit undone back to the start counts as no edit.
 *
 * Trailing blank lines are left out of that comparison. Tiptap adds an empty paragraph after a
 * final table or list the first time the editor is focused, so the caret can be placed below it,
 * and that paragraph reads out as blank lines at the end. The server trims every field before
 * comparing it with the current version, so blank lines at the end never make a version either.
 *
 * **Controlled, like the Markdown box.** A `value` the parent sets on its own — a rule set copied
 * in from "Start from", a comment box cleared after posting — replaces the content, and becomes the
 * new text an untouched editor hands back.
 */
export function RichMarkdownEditor({
  value,
  onChange,
  id,
  ariaLabel,
  placeholder,
  rows = 8,
  autoFocus,
  initialPoint,
  disabled,
  onEditAsMarkdown,
  className,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  /** On the editable element, so a `<label htmlFor>` and a test can find it. */
  id?: string;
  /** The editable element's accessible name, since it is not a form element a label can name. */
  ariaLabel?: string;
  /** Shown in the empty box, and gone as soon as anything is typed. */
  placeholder?: string;
  /** The height the empty box is drawn at, in lines, as `rows` sets it on a `textarea`. */
  rows?: number;
  autoFocus?: boolean;
  /**
   * Where the caret starts, as a point measured from the top left of the text area, for a box
   * opened by double-clicking the rendered text at that point. The caret goes to the nearest
   * position in the text.
   */
  initialPoint?: { x: number; y: number };
  disabled?: boolean;
  /** Draws a button at the end of the toolbar that switches the field to the Markdown box. */
  onEditAsMarkdown?: () => void;
  className?: string;
  ref?: React.Ref<{ focus: () => void }>;
}) {
  /*
    `given` is the text the editor was last handed, `reformatted` is how Tiptap writes that text
    back out with trailing whitespace removed, and `sent` is what `onChange` last reported. The
    listener reads them through a ref because the editor is built once, and a listener that closed
    over the first render would keep comparing against the first value.

    `reformatted` is null until the effect below records it, and the listener hands back the
    original text only once it exists, so no update can be compared against a missing baseline.
  */
  const texts = React.useRef<{ given: string; reformatted: string | null; sent: string }>({
    given: value,
    reformatted: null,
    sent: value,
  });
  const callbacks = React.useRef({ onChange });
  React.useEffect(() => {
    callbacks.current = { onChange };
  });

  const editor = useEditor({
    extensions: richMarkdownExtensions({ placeholder }),
    content: value,
    contentType: "markdown",
    editable: !disabled,
    autofocus: autoFocus && !initialPoint ? "end" : false,
    // Rendered in the browser only: the server has no document to draw an editor into, and
    // rendering it there would not match what the browser draws on its first pass.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        role: "textbox",
        "aria-multiline": "true",
        class: "rich-markdown px-2.5 py-2 outline-none",
      },
    },
    onUpdate: ({ editor: updated }) => {
      const markdown = updated.getMarkdown();
      const next =
        markdown.trimEnd() === texts.current.reformatted ? texts.current.given : markdown;
      /*
        Focusing the editor adds a trailing paragraph and so fires this with nothing changed. The
        parent is told nothing then: a form that rebuilds its state on every change would revalidate
        and briefly disable its Save for a click into a box.
      */
      if (next === texts.current.sent) return;
      texts.current.sent = next;
      callbacks.current.onChange(next);
    },
  });

  React.useImperativeHandle(ref, () => ({ focus: () => editor?.commands.focus() }), [editor]);

  /*
    Records the baseline the first time the editor exists, and replaces the content when the parent
    hands over a value it did not receive from here. Declared before the `setEditable` effect so the
    baseline exists before anything else touches the editor.
  */
  React.useEffect(() => {
    if (!editor) return;
    if (value !== texts.current.sent) {
      editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
      texts.current = { given: value, reformatted: null, sent: value };
    }
    if (texts.current.reformatted === null) {
      texts.current.reformatted = editor.getMarkdown().trimEnd();
    }
  }, [editor, value]);

  React.useEffect(() => {
    // `false`: Tiptap reports a change of editability as an edit unless told not to.
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  /*
    The caret at the point that was double-clicked. The point is measured from the text area's
    corner rather than the screen, because the toolbar above the text pushes it down from where
    the rendered text was drawn.
  */
  const textArea = React.useRef<HTMLDivElement>(null);
  /** When Escape was last pressed in the text, for Escape-then-Tab below. */
  const escapedAt = React.useRef(0);
  const placed = React.useRef(false);
  React.useEffect(() => {
    if (!editor || !initialPoint || placed.current || !textArea.current) return;
    placed.current = true;
    const corner = textArea.current.getBoundingClientRect();
    const found = editor.view.posAtCoords({
      left: corner.left + initialPoint.x,
      top: corner.top + initialPoint.y,
    });
    editor
      .chain()
      .focus()
      .setTextSelection(found?.pos ?? editor.state.doc.content.size)
      .run();
  }, [editor, initialPoint]);

  return (
    <div
      style={{ minHeight: `calc(${rows} * 1.5em + 1rem)` }}
      className={cn(
        // The same box `MarkdownSourceEditor` draws, so the two read as one kind of field.
        "flex w-full flex-col overflow-hidden rounded-lg border border-input bg-transparent text-base leading-normal transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:text-sm dark:bg-input/30",
        disabled && "cursor-not-allowed bg-input/50 opacity-50 dark:bg-input/80",
        className,
      )}
    >
      {editor && !disabled && <Toolbar editor={editor} onEditAsMarkdown={onEditAsMarkdown} />}
      {/*
        `min-h-0` lets a caller's `max-h-*` cap the box and have the text scroll inside it, rather
        than the content pushing the box taller than the cap.
      */}
      <div
        ref={textArea}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        /*
          Escape and then Tab, within two seconds, moves to the next field, so a keyboard user is
          never trapped in the box — the Markdown box's own rule. The Tab is stopped here, while it
          travels down to the editor, so the editor's Tab handling never sees it, and its default
          is left alone, so the browser moves the focus.
        */
        onKeyDownCapture={(event) => {
          if (event.key === "Escape") escapedAt.current = Date.now();
          else if (event.key === "Tab" && Date.now() - escapedAt.current < 2000) {
            escapedAt.current = 0;
            event.stopPropagation();
          }
        }}
        onMouseDown={(event) => {
          // A press below the last line puts the caret at the end, as it would in a `textarea`.
          if (!editor || disabled || event.target !== event.currentTarget) return;
          /*
            A press on the scrollbar is a scroll, and taking it would jump the text to the end
            instead. `clientWidth` and `clientHeight` leave the scrollbar out of the element's box,
            so a press past either edge of them is a press on it.
          */
          const target = event.currentTarget;
          const box = target.getBoundingClientRect();
          if (event.clientX > box.left + target.clientWidth) return;
          if (event.clientY > box.top + target.clientHeight) return;
          event.preventDefault();
          editor.commands.focus("end");
        }}
      >
        <EditorContent editor={editor} />
      </div>
      {editor && !disabled && <TableBar editor={editor} />}
    </div>
  );
}

/**
 * The editor's extensions, as a function so each editor gets its own instances.
 *
 * Exported so that text can be run through the same extensions outside a browser, to check what
 * the editor does to it; see the comment on `RichMarkdownEditor` for why that matters.
 */
export function richMarkdownExtensions({ placeholder }: { placeholder?: string } = {}) {
  return [
    StarterKit.configure({
      // A link in the editor is text to change, so clicking it places the caret instead of leaving.
      link: { openOnClick: false },
      // Replaced by `CodeBlockWithLanguage`, which adds the language picker and the colours.
      codeBlock: false,
    }),
    // Tab indents a line of code by two spaces, and Shift+Tab takes them away.
    CodeBlockWithLanguage.configure({ enableTabIndentation: true, tabSize: 2 }),
    /*
      A table cell holds paragraphs only. Markdown keeps a cell on one line, so a list, heading or
      code block typed into a cell would be flattened into broken text when the table is saved;
      with this, the list and code buttons and their typed shortcuts do nothing inside a cell.
    */
    TableKit.configure({ tableCell: false, tableHeader: false }),
    TableCell.extend({ content: "paragraph+" }),
    TableHeader.extend({ content: "paragraph+" }),
    // Sample reports open their checklist sections with `- [x]` items.
    TaskList,
    TaskItem.configure({ nested: true }),
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    LeaveModEnterToTheForm,
    TabStaysInTheEditor,
    Markdown,
  ];
}

/**
 * Tab kept inside the editor, as it is in the Markdown box.
 *
 * Tab and Shift+Tab already indent and outdent a list item, a line of code, and move between table
 * cells; those extensions take the key first. This one runs after them and takes it everywhere
 * else, where it would otherwise move the focus out of the box in the middle of writing. Escape
 * and then Tab leaves the box instead; see `escapedAt` in `RichMarkdownEditor`.
 */
const TabStaysInTheEditor = Extension.create({
  name: "tabStaysInTheEditor",
  priority: 1,
  addKeyboardShortcuts() {
    return { Tab: () => true, "Shift-Tab": () => true };
  },
});

/**
 * Ctrl+Enter (Cmd+Enter on a Mac) left for the form around the editor.
 *
 * Forms use it to send: a comment posts on it, and the review screen arms its release on it. The
 * line-break extension binds it too, so without this it would add a blank line as the form sent.
 * Claiming the key here does nothing in the editor, and the key still reaches the form, because
 * the editor stops the browser's default action but not the event.
 *
 * Shift+Enter breaks a line, and inside a code block it starts a new line of code. The line-break
 * extension's own handling would leave the code block for a paragraph below it instead.
 */
const LeaveModEnterToTheForm = Extension.create({
  name: "leaveModEnterToTheForm",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => true,
      "Shift-Enter": () =>
        this.editor.isActive("codeBlock") ? this.editor.commands.newlineInCode() : false,
    };
  },
});

/**
 * The formatting buttons above the text.
 *
 * Each icon button carries its name as its accessible name and as a tooltip, because an icon alone
 * does not say which of the three kinds of list it makes.
 */
function Toolbar({ editor, onEditAsMarkdown }: { editor: Editor; onEditAsMarkdown?: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      code: current.isActive("code"),
      heading1: current.isActive("heading", { level: 1 }),
      heading2: current.isActive("heading", { level: 2 }),
      heading3: current.isActive("heading", { level: 3 }),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      taskList: current.isActive("taskList"),
      codeBlock: current.isActive("codeBlock"),
      inTable: current.isActive("table"),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });

  const run = (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) =>
    command(editor.chain().focus()).run();

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-1 py-1">
      <Mark
        label="Bold"
        icon={<Bold />}
        pressed={state.bold}
        onPress={() => run((c) => c.toggleBold())}
      />
      <Mark
        label="Italic"
        icon={<Italic />}
        pressed={state.italic}
        onPress={() => run((c) => c.toggleItalic())}
      />
      <Mark
        label="Code"
        icon={<Code />}
        pressed={state.code}
        onPress={() => run((c) => c.toggleCode())}
      />
      <Divider />
      <Mark
        label="Heading 1"
        icon={<Heading1 />}
        pressed={state.heading1}
        onPress={() => run((c) => c.toggleHeading({ level: 1 }))}
      />
      <Mark
        label="Heading 2"
        icon={<Heading2 />}
        pressed={state.heading2}
        onPress={() => run((c) => c.toggleHeading({ level: 2 }))}
      />
      <Mark
        label="Heading 3"
        icon={<Heading3 />}
        pressed={state.heading3}
        onPress={() => run((c) => c.toggleHeading({ level: 3 }))}
      />
      <Divider />
      <Mark
        label="Bulleted list"
        icon={<List />}
        pressed={state.bulletList}
        onPress={() => run((c) => c.toggleBulletList())}
      />
      <Mark
        label="Numbered list"
        icon={<ListOrdered />}
        pressed={state.orderedList}
        onPress={() => run((c) => c.toggleOrderedList())}
      />
      <Mark
        label="Checklist"
        icon={<ListChecks />}
        pressed={state.taskList}
        onPress={() => run((c) => c.toggleTaskList())}
      />
      <Divider />
      <Mark
        label="Code block"
        icon={<SquareCode />}
        pressed={state.codeBlock}
        onPress={() => run((c) => c.toggleCodeBlock())}
      />
      <Action
        label="Insert table"
        icon={<Table />}
        disabled={state.inTable}
        onPress={() => run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}
      />
      <Divider />
      <Action
        label="Undo"
        icon={<Undo2 />}
        disabled={!state.canUndo}
        onPress={() => run((c) => c.undo())}
      />
      <Action
        label="Redo"
        icon={<Redo2 />}
        disabled={!state.canRedo}
        onPress={() => run((c) => c.redo())}
      />
      {onEditAsMarkdown && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onEditAsMarkdown}
        >
          <FileCode data-icon="inline-start" />
          Edit as Markdown
        </Button>
      )}
    </div>
  );
}

/**
 * The table buttons, beneath the text while the caret is in a table.
 *
 * Beneath rather than with the formatting buttons above, because a row appearing above the text
 * would push the text down at the moment the caret entered the table, and the cell the instructor
 * had just clicked would move away from the pointer.
 */
function TableBar({ editor }: { editor: Editor }) {
  const place = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      inTable: current.isActive("table"),
      inHeader: current.isActive("tableHeader"),
    }),
  });
  if (!place.inTable) return null;

  const run = (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) =>
    command(editor.chain().focus()).run();

  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-border bg-muted/30 px-1.5 py-1">
      <span className="mr-1 text-xs text-muted-foreground">Table</span>
      {/*
        Nothing goes above the header row, and the header row cannot be deleted. Markdown has
        exactly one header row and it is always the first, so a row added above it or the row
        below it promoted by a deletion would be saved as the header, and the table would reopen
        looking different from the one that was built. Its headings are typed over instead.
      */}
      <TableButton disabled={place.inHeader} onPress={() => run((c) => c.addRowBefore())}>
        Row above
      </TableButton>
      <TableButton onPress={() => run((c) => c.addRowAfter())}>Row below</TableButton>
      <TableButton onPress={() => run((c) => c.addColumnBefore())}>Column left</TableButton>
      <TableButton onPress={() => run((c) => c.addColumnAfter())}>Column right</TableButton>
      <Divider />
      <TableButton disabled={place.inHeader} onPress={() => run((c) => c.deleteRow())}>
        Delete row
      </TableButton>
      <TableButton onPress={() => run((c) => c.deleteColumn())}>Delete column</TableButton>
      <TableButton onPress={() => run((c) => c.deleteTable())}>Delete table</TableButton>
    </div>
  );
}

/** A formatting button that shows whether the formatting is on where the caret is. */
function Mark({
  label,
  icon,
  pressed,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  pressed: boolean;
  onPress: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            size="sm"
            aria-label={label}
            pressed={pressed}
            onPressedChange={onPress}
            // Keeps the editor's selection: focus moving to the button would collapse it first.
            onMouseDown={(event) => event.preventDefault()}
          >
            {icon}
          </Toggle>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A button that does one thing once, such as inserting a table. */
function Action({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onPress}
          >
            {icon}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function TableButton({
  onPress,
  disabled,
  children,
}: {
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {children}
    </Button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-border" />;
}
