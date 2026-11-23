/**
 * Which code blocks in a lesson can be run in the browser, and the page a web block runs in.
 *
 * **Every block in a language the page can run gets a Run button.** Python blocks run in a Python
 * built for the browser inside a Web Worker, with a terminal beneath the block for what they print
 * and for `input()`. HTML blocks render in a frame beneath the block, and the CSS and JavaScript
 * blocks that follow one in the same part of the lesson are put into the same page, because a
 * lesson that shows a page's HTML, then its CSS, then its JavaScript means them as one page. A
 * JavaScript block on its own runs in a frame with nothing drawn and only its console shown.
 * Blocks in every other language, such as shell sessions and plain text, are drawn as before.
 *
 * **A Python block runs on its own**, in a fresh interpreter, so it can use only the names it
 * defines. A block that builds on code shown earlier names a hidden setup instead of repeating
 * it, in the comments the curriculum's authoring guide defines:
 *
 * ```markdown
 * <!-- setup: event
 * class Event: ...
 * -->
 *
 * <!-- uses: event, find-events -->
 * ```python
 * print(hall.find_events(is_free))
 * ```
 * ```
 *
 * A `setup:` comment defines a named piece of Python anywhere on the page. A `uses:` comment on
 * the line above a block's fence, or above the `{% code %}` line around it, names the setups to
 * run before the block, in that order and in the block's interpreter. A `not-runnable` comment in
 * the same place leaves the block with no Run button. Neither GitBook nor the page shows a comment.
 *
 * `markRunnable` runs after `rehype-sanitize`, which is told to keep comments, and `rehypeLesson`,
 * and writes `data-run` on each runnable `<pre>`, with `data-setup` holding the Python its setups
 * add up to, which `LessonMarkdown` reads to draw the block with its button. Pure, with type-only
 * input, so its tests can hand it a tree built by hand.
 */

/** The parts of a rendered node this reads and writes. */
type RenderedNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: RenderedNode[];
  properties?: Record<string, unknown>;
};

/** What a runnable block is: Python with a terminal, a web page, or JavaScript with a console. */
export type RunKind = "python" | "web" | "javascript";

const PYTHON = new Set(["python", "py", "python3"]);
const HTML = new Set(["html"]);
const CSS = new Set(["css"]);
const JAVASCRIPT = new Set(["js", "javascript"]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** `<!-- setup: name` on the comment's first line; the code is every line after it. */
const SETUP = /^[ \t]*setup:[ \t]*([a-z0-9-]+)[ \t]*\n([\s\S]*)$/;
/** `<!-- uses: a, b -->`. */
const USES = /^\s*uses:\s*([a-z0-9, -]*?)\s*$/;
/** `<!-- not-runnable -->`. */
const NOT_RUNNABLE = /^\s*not-runnable\s*$/;

function textOf(node: RenderedNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** The language a fenced block names, lower-cased, or null for a fence with none. */
export function fenceLanguage(pre: RenderedNode): string | null {
  const code = pre.children?.[0];
  if (!code || code.type !== "element" || code.tagName !== "code") return null;
  const classes = code.properties?.className;
  const names = Array.isArray(classes)
    ? classes.map(String)
    : typeof classes === "string"
      ? classes.split(/\s+/)
      : [];
  for (const name of names) {
    const match = /^language-([\w-]+)$/.exec(name);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

/**
 * The `<pre>` a node is, or holds: a titled fence, `{% code title="x" %}` in GitBook, arrives as
 * a `<div data-code-title>` around its `<pre>`, and is read as that `<pre>` wherever a block is
 * looked for, so a titled block runs and is found as a companion like an untitled one.
 */
function preOf(node: RenderedNode): RenderedNode | null {
  if (node.type !== "element") return null;
  if (node.tagName === "pre") return node;
  if (node.tagName === "div" && node.properties?.dataCodeTitle !== undefined) {
    return (
      (node.children ?? []).find((child) => child.type === "element" && child.tagName === "pre") ??
      null
    );
  }
  return null;
}

/** A fenced block's text, without the newline the parser leaves before the closing fence. */
export function codeOf(pre: RenderedNode): string {
  const code = pre.children?.[0];
  return code ? textOf(code).replace(/\n$/, "") : "";
}

/**
 * Every setup the page defines, by name, from `setup:` comments at any depth. Collected before
 * any block is marked, so a block may name a setup written anywhere on its page.
 */
export function readSetups(tree: RenderedNode, into = new Map<string, string>()): Map<string, string> {
  for (const child of tree.children ?? []) {
    if (child.type === "comment") {
      const match = SETUP.exec(child.value ?? "");
      // The comment's text ends with the newline before `-->`, which is not part of the code.
      if (match) into.set(match[1], match[2].replace(/\n$/, ""));
    } else {
      readSetups(child, into);
    }
  }
  return into;
}

/** What the comment directly above a block asks for, carried until the block is reached. */
type Pending = { uses: string[] } | { notRunnable: true } | null;

function pendingFrom(comment: string): Pending {
  if (NOT_RUNNABLE.test(comment)) return { notRunnable: true };
  const uses = USES.exec(comment);
  if (uses) {
    return {
      uses: uses[1]
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== ""),
    };
  }
  return null;
}

/**
 * Writes `data-run` on every runnable `<pre>` in the tree.
 *
 * An HTML block also takes the CSS and JavaScript blocks after it, up to the next heading or the
 * next HTML block, as `data-run-css` and `data-run-js`, one of each; those blocks are marked
 * `data-run-part` and get no button of their own, since they run with the page above them. Blocks
 * are looked for at every depth, so one inside a `<details>` dropdown or a `<section>` is found,
 * and companions are looked for among a block's siblings, which is where a lesson puts them.
 *
 * A `uses:` or `not-runnable` comment applies to the next block among its siblings, and to
 * nothing if another element comes first: the guide puts the comment directly above the block.
 * A Python block with setups gets `data-setup`, the named setups' code in the order named, and
 * `data-setup-missing` naming any setup the page does not define, so the runner can say so.
 */
export function markRunnable(tree: RenderedNode): void {
  mark(tree, readSetups(tree));
}

function mark(tree: RenderedNode, setups: Map<string, string>): void {
  const children = tree.children ?? [];
  let pending: Pending = null;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.type === "comment") {
      pending = pendingFrom(child.value ?? "") ?? pending;
      continue;
    }
    if (child.type !== "element") continue;
    const node = preOf(child);
    if (node === null) {
      pending = null;
      mark(child, setups);
      continue;
    }
    const asked = pending;
    pending = null;
    const language = fenceLanguage(node);
    if (language === null) continue;
    const properties = (node.properties ??= {});
    // Claimed by an HTML block before it.
    if (properties.dataRunPart !== undefined) continue;
    if (asked !== null && "notRunnable" in asked) continue;

    if (PYTHON.has(language)) {
      properties.dataRun = "python";
      if (asked !== null && asked.uses.length > 0) {
        const found = asked.uses.filter((name) => setups.has(name));
        const missing = asked.uses.filter((name) => !setups.has(name));
        if (found.length > 0) {
          properties.dataSetup = found.map((name) => setups.get(name)).join("\n\n");
        }
        if (missing.length > 0) properties.dataSetupMissing = missing.join(", ");
      }
      continue;
    }
    if (JAVASCRIPT.has(language)) {
      properties.dataRun = "javascript";
      continue;
    }
    if (!HTML.has(language)) continue;

    properties.dataRun = "web";
    for (let after = index + 1; after < children.length; after += 1) {
      const sibling = children[after];
      if (sibling.type !== "element" || !sibling.tagName) continue;
      if (HEADINGS.has(sibling.tagName)) break;
      const next = preOf(sibling);
      if (next === null) continue;
      const nextLanguage = fenceLanguage(next);
      if (nextLanguage === null) continue;
      if (HTML.has(nextLanguage)) break;
      const nextProperties = (next.properties ??= {});
      if (CSS.has(nextLanguage) && properties.dataRunCss === undefined) {
        properties.dataRunCss = codeOf(next);
        nextProperties.dataRunPart = "css";
      } else if (JAVASCRIPT.has(nextLanguage) && properties.dataRunJs === undefined) {
        properties.dataRunJs = codeOf(next);
        nextProperties.dataRunPart = "javascript";
      }
    }
  }
}

/**
 * The script at the top of every page a web block runs in. It sends each `console.log`, `info`,
 * `warn` and `error`, and every uncaught error, to the page around the frame as a message, so the
 * console panel under the frame can show them. The frame is sandboxed without its own origin, so
 * a message is the only way out, and the panel takes only messages marked as this script's.
 */
export const CONSOLE_BRIDGE = `<script>(function(){
var send=function(level,parts){try{parent.postMessage({source:"lesson-runner",level:level,text:parts.map(function(part){if(part instanceof Error){return part.stack||part.message}if(part!==null&&typeof part==="object"){try{return JSON.stringify(part)}catch(e){return String(part)}}return String(part)}).join(" ")},"*")}catch(e){}};
["log","info","warn","error"].forEach(function(level){var original=console[level];console[level]=function(){send(level,Array.prototype.slice.call(arguments));if(original)original.apply(console,arguments)}});
window.addEventListener("error",function(event){send("error",[event.message])});
window.addEventListener("unhandledrejection",function(event){send("error",[String(event.reason)])});
})();</script>`;

/**
 * The page a web block runs in: the HTML as written, with the CSS in a `<style>` in its head and
 * the JavaScript in a `<script>` at the end of its body, and the console bridge first of all so
 * that output from a script in the head is caught too. HTML that is a fragment, as most lessons'
 * blocks are, is wrapped in a document; HTML that is already a document has the pieces put into
 * it. The result is what the frame's `srcdoc` holds.
 */
export function buildWebPage(parts: { html: string; css?: string; js?: string }): string {
  const style = parts.css ? `<style>\n${parts.css}\n</style>` : "";
  const script = parts.js ? `<script>\n${parts.js}\n</script>` : "";
  const html = parts.html;

  if (/<html[\s>]/i.test(html)) {
    let page = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (head) => `${head}\n${CONSOLE_BRIDGE}\n${style}`)
      : html.replace(
          /<html[^>]*>/i,
          (open) => `${open}\n<head>\n${CONSOLE_BRIDGE}\n${style}\n</head>`,
        );
    if (script) {
      page = /<\/body>/i.test(page)
        ? page.replace(/<\/body>/i, `${script}\n</body>`)
        : `${page}\n${script}`;
    }
    return page;
  }

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    CONSOLE_BRIDGE,
    style,
    "</head>",
    "<body>",
    html,
    script,
    "</body>",
    "</html>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
