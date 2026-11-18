import { formattedEditorWouldChange } from "@/lib/markdown/formatted-editor";

/**
 * Which text opens in the Markdown box rather than the formatted editor. Each case here was saved
 * through the formatted editor first, and the ones marked as damaged came back changed.
 */
describe("formattedEditorWouldChange", () => {
  it.each([
    ["an HTML comment", "Text <!-- note --> more"],
    ["a details block", "<details>\n<summary>Hint</summary>\n\nInside\n\n</details>"],
    ["an inline tag", "Press <kbd>Ctrl</kbd> now"],
    ["a closing tag on its own", "text </div>"],
    ["code in a numbered list item", "1. Step\n\n   ```js\n   const a = 1;\n   ```"],
  ])("opens %s in the Markdown box", (_, markdown) => {
    expect(formattedEditorWouldChange(markdown)).toBe(true);
  });

  it.each([
    ["plain prose with a table", "## Bands\n\n| A | B |\n| --- | --- |\n| 1 | x<br>y |"],
    ["a line break tag", "Line one<br>line two"],
    ["a self-closing line break", "Line one<br/>line two"],
    ["a web address in angle brackets", "See <https://example.com>"],
    ["a tag inside inline code", "Use `<img>` here"],
    ["tags inside a fenced block", "```html\n<div>hi</div>\n```"],
    ["tags inside a four-backtick block", "````markdown\n```html\n<p>x</p>\n```\n````"],
    ["code in a bulleted list item", "- Step\n\n  ```js\n  const a = 1;\n  ```"],
    ["a comparison in prose", "when a < b and b > c"],
  ])("opens %s as formatted text", (_, markdown) => {
    expect(formattedEditorWouldChange(markdown)).toBe(false);
  });
});
