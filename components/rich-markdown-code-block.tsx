"use client";

import { CodeBlock } from "@tiptap/extension-code-block";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronDown } from "lucide-react";

import { codeTokenRanges } from "@/components/code-token-ranges";
import { CODE_BLOCK_LANGUAGES } from "@/lib/diff/languages";

/**
 * A code block in the formatted editor: a language to choose above it, the code coloured the way
 * rendered Markdown colours it, and a fence long enough to hold whatever is inside.
 *
 * **The fence grows with its contents.** Tiptap writes every code block between three backticks.
 * A Markdown block that shows its own ```` ``` ```` fences — how a rubric demonstrates a code
 * block to a fellow — would then end at its first inner fence, and everything after it would
 * spill out of the block as ordinary text. So the fence is one backtick longer than the longest
 * run of backticks inside, and never shorter than three: a block holding ```` ``` ```` fences is
 * written between ```` ```` ```` fences, the way an author writes one by hand. Reading such a
 * block already works, because the parser follows the standard fence rules.
 */
export const CodeBlockWithLanguage = CodeBlock.extend({
  renderMarkdown(node) {
    const language: string = node.attrs?.language ?? "";
    const code = (node.content ?? []).map((child) => child.text ?? "").join("");
    const longestRun = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    return `${fence}${language}\n${code}\n${fence}`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), highlightPlugin()];
  },
});

/**
 * The language picker above the code, and the code itself.
 *
 * **A native `select`, not the application's `Select`.** This sits inside the editable text, and
 * the application's popup moves focus into a layer outside it, which leaves the editor's selection
 * behind; the browser's own list opens and closes without touching it.
 *
 * A fence language the picker does not list, such as `text`, is offered under its own name, so
 * opening a block and saving it never changes the language it was written with.
 */
function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const language: string = node.attrs.language ?? "";
  const listed = CODE_BLOCK_LANGUAGES.some((option) => option.fence === language);

  return (
    <NodeViewWrapper className="code-block">
      <div contentEditable={false} className="flex justify-end border-b border-border px-2 py-1">
        {/*
          The browser's own arrow is drawn inside the select's padding and was cut off at this
          size, so it is hidden (`appearance-none`) and this one sits in room the padding keeps.
        */}
        <div className="relative">
          <select
            aria-label="Code language"
            value={language}
            disabled={!editor.isEditable}
            onChange={(event) => updateAttributes({ language: event.target.value || null })}
            className="h-6 appearance-none rounded border border-input bg-background pr-6 pl-2 text-xs text-foreground"
          >
            {CODE_BLOCK_LANGUAGES.map((option) => (
              <option key={option.fence} value={option.fence}>
                {option.label}
              </option>
            ))}
            {!listed && <option value={language}>{language}</option>}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

const highlightKey = new PluginKey<DecorationSet>("codeBlockHighlight");

/**
 * Colours every code block whose language the highlighter knows, as decorations over its text.
 *
 * Decorations rather than marks, because a colour is how the text is drawn and not part of the
 * document: it never reaches the Markdown. The tokens come from `codeTokenRanges`, which answers
 * at once when it already knows a text and otherwise calls back once the tokens arrive, at which
 * point a transaction carrying this plugin's key rebuilds the decorations.
 */
function highlightPlugin() {
  let view: EditorView | null = null;
  const refresh = () => {
    if (view) view.dispatch(view.state.tr.setMeta(highlightKey, true));
  };

  return new Plugin<DecorationSet>({
    key: highlightKey,
    state: {
      init: (_, state) => decorate(state.doc, DecorationSet.empty, refresh),
      apply: (tr, previous) => {
        if (!tr.docChanged && !tr.getMeta(highlightKey)) return previous;
        return decorate(tr.doc, previous.map(tr.mapping, tr.doc), refresh);
      },
    },
    props: {
      decorations: (state) => highlightKey.getState(state),
    },
    view: (editorView) => {
      view = editorView;
      return {
        destroy: () => {
          view = null;
        },
      };
    },
  });
}

/**
 * The decorations for `doc`, built afresh for every code block in it.
 *
 * `previous` is the last set, mapped through the change. Only a block whose tokens are still on
 * their way takes anything from it, keeping the colours it had so that a block being typed in
 * does not flash uncoloured between keystrokes; it is redrawn once its tokens arrive. Nothing else
 * is carried over, so text that stopped being a code block loses its colours.
 */
function decorate(
  doc: ProseMirrorNode,
  previous: DecorationSet,
  onReady: () => void,
): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== "codeBlock") return true;

    const start = position + 1;
    const ranges = codeTokenRanges(node.textContent, node.attrs.language ?? "", onReady);
    if (ranges === undefined) {
      decorations.push(...previous.find(start, start + node.content.size));
    } else if (ranges) {
      for (const range of ranges) {
        if (range.to <= range.from) continue;
        decorations.push(
          Decoration.inline(start + range.from, start + range.to, {
            class: "shiki-token",
            style: range.style,
          }),
        );
      }
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}
