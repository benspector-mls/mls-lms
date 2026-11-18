/**
 * Whether the formatted editor would damage this markdown once anything in it was edited, so the
 * field should open in the Markdown box instead.
 *
 * The formatted editor hands back a field's original text while nobody has edited it, but the
 * first edit makes it write the whole field out again in its own Markdown, and two things do not
 * survive that:
 *
 * - **HTML other than `<br>`.** A comment such as `<!-- note -->` is deleted outright, and tags
 *   such as `<details>` or `<kbd>` are stripped from around their text. A `<br>` survives as a
 *   line break, and a tag inside code survives as code.
 * - **A code block indented three or more spaces**, which is how a code block sits inside a
 *   numbered list item. Tiptap reads one space too many into the code, so every save indents the
 *   code one space further. A code block in a bulleted list, indented two, comes back as it was.
 *
 * Both were found by saving real text through the editor; other markdown keeps its meaning.
 */
export function formattedEditorWouldChange(markdown: string): boolean {
  if (/^ {3,}(`{3,}|~{3,})/m.test(markdown)) return true;

  const outsideCode = markdown.replace(/(`{3,}|~{3,})[\s\S]*?\1/g, "").replace(/`[^`\n]*`/g, "");
  return /<(?!br\s*\/?>|https?:|mailto:)[a-z!/][^>]*>/i.test(outsideCode);
}
