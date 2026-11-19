/**
 * GitBook's block tags, rewritten as the HTML the lesson page draws.
 *
 * The lessons are written for GitBook, which reads lines such as `{% hint style="info" %}` as the
 * start of a callout. A markdown parser reads the same line as an ordinary sentence, and when the
 * tag has no blank line after it — the first hint in "1.6 Loops" is written that way — the tag,
 * the callout's words and `{% endhint %}` all become one paragraph. Fellows would see the tags as
 * text and no callout.
 *
 * **Each tag line becomes an HTML line with a blank line on either side.** CommonMark keeps a line
 * such as `<aside data-hint="info">` as raw HTML and goes on reading the lines after the blank line
 * as markdown, so the callout's links, bold words and code still render inside it. That is the same
 * rule that already makes the lessons' 218 `<details>` dropdowns work, and `rehype-raw` joins the
 * opening and closing lines back into one element around what is between them.
 *
 * | Tag | Becomes |
 * |---|---|
 * | `{% hint style="x" %}` … `{% endhint %}` | `<aside data-hint="x">` … `</aside>` |
 * | `{% code title="x" … %}` … `{% endcode %}` | `<div data-code-title="x">` … `</div>`, around the fence |
 * | `{% embed url="x" %}` | `<div data-embed="x"></div>` |
 *
 * A tag line keeps its indentation, so a callout inside a list item stays inside it. Lines inside a
 * fenced code block are left alone. A tag not in the table, or one sharing its line with other
 * text, is left as it is, and the sync reports it; see `unknownGitbookTags` and
 * `inlineGitbookTags`.
 *
 * Pure, so it runs in the browser and its tests need nothing.
 */

import { forEachProseLine, GITBOOK_TAG_LINE } from "./outline";

/** A value placed inside a double-quoted HTML attribute. */
function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** The value of `name="…"` inside a tag, or null. */
function tagAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
}

/** The HTML that replaces one tag line, or null for a line that is not a tag this module knows. */
function replacement(tag: string): string | null {
  const name = /^\{%\s*([a-zA-Z]+)/.exec(tag)?.[1];

  switch (name) {
    case "hint":
      return `<aside data-hint="${attribute(tagAttribute(tag, "style") ?? "info")}">`;
    case "endhint":
      return "</aside>";
    case "code":
      return `<div data-code-title="${attribute(tagAttribute(tag, "title") ?? "")}">`;
    case "endcode":
      return "</div>";
    case "embed": {
      const url = tagAttribute(tag, "url");
      return url === null ? null : `<div data-embed="${attribute(url)}"></div>`;
    }
    default:
      return null;
  }
}

export function gitbookToHtml(markdown: string): string {
  const replaced = new Map<number, string>();

  forEachProseLine(markdown, (line, index) => {
    const tag = GITBOOK_TAG_LINE.exec(line);
    const html = tag ? replacement(tag[2]) : null;
    if (tag && html !== null) replaced.set(index, `${tag[1]}${html}`);
  });

  return markdown
    .split("\n")
    .flatMap((line, index) => {
      const html = replaced.get(index);
      return html === undefined ? [line] : ["", html, ""];
    })
    .join("\n");
}
