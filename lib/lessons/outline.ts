/**
 * What a lesson's markdown holds besides its prose: its headings and the anchors they are reached
 * by, the sections search will read, and the images it shows.
 *
 * **The server and the browser both read this module, and that is why it exists.** The sync works
 * out each section's anchor when it stores the section, and the lesson page gives each rendered
 * heading its id. A search result links to `#<anchor>`, so the two have to agree on every heading
 * of every lesson. They agree because they call the same `headingSlugger` here.
 *
 * Pure, with no imports, so the browser bundle can include it and its tests need nothing.
 */

/**
 * The fragment GitHub and GitBook give a heading, as a function that remembers the headings before
 * it.
 *
 * The rule is GitHub's: lower-case the text, delete every character that is not a letter, a mark,
 * a digit, a connector such as `_`, a space or a hyphen, then turn each space into a hyphen. A
 * heading whose fragment was already used gets `-1`, then `-2`, so two "Summary" headings in one
 * lesson are `summary` and `summary-1`. A numbered fragment that another heading already has is
 * skipped, so "Question 1" followed by two "Question" headings gives `question-1`, `question` and
 * `question-2`, and no two headings share an id. The authors wrote the 576 in-page links in the
 * lessons by this rule, so following it is what keeps those links working.
 *
 * Call it once per lesson and pass it every heading in document order, because the numbering
 * depends on the headings that came before.
 */
export function headingSlugger(): (text: string) => string {
  const occurrences = new Map<string, number>();

  return (text) => {
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");

    let slug = base;
    while (occurrences.has(slug)) {
      const count = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, count);
      slug = `${base}-${count}`;
    }
    occurrences.set(slug, 0);
    return slug;
  };
}

/**
 * A heading's words as they appear on the page, from its markdown.
 *
 * The page renders `The \`for\` loop` as "The for loop" and `[Setup](x.md)` as "Setup", and the id
 * is made from what is rendered, so the markdown has to be reduced the same way before it is
 * slugged. Emphasis markers are left in, because `headingSlugger` deletes `*` anyway; the lessons
 * use `_` only inside code, where it is part of the word.
 */
export function headingText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`/g, "")
    .trim();
}

/**
 * A lesson's markdown without the settings block GitBook reads from the top of a page.
 *
 * GitBook keeps a page's cover image and layout switches between two `---` lines at the start of
 * the file. A markdown parser reads that block as a rule followed by a heading made of every
 * setting, so the sync removes it before the lesson is stored.
 */
export function withoutFrontMatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
}

/** One ATX heading of a lesson, in document order. */
export type LessonHeading = { level: number; text: string; anchor: string };

/**
 * Calls `onLine` for every line of `markdown` that is not inside a fenced code block, with the
 * line's index.
 *
 * A fence closes only on a run of the same character at least as long as the one that opened it,
 * which matters here: a lesson shows a Python traceback whose `~~~` underline sits inside a
 * backtick fence, and closing on it would read the rest of the code as prose.
 */
export function forEachProseLine(markdown: string, onLine: (line: string, index: number) => void) {
  forEachLine(markdown, (line, index, inCode) => {
    if (!inCode) onLine(line, index);
  });
}

/**
 * Calls `onLine` for every line of `markdown` with whether it is inside a fenced code block and,
 * when it is, the language the fence names (`python`, `mermaid`, or empty), with the same fence
 * rules as `forEachProseLine`. The fence lines themselves are neither, and are left out.
 */
export function forEachLine(
  markdown: string,
  onLine: (line: string, index: number, inCode: boolean, language: string) => void,
) {
  let fence: { char: string; length: number; language: string } | null = null;

  markdown.split("\n").forEach((line, index) => {
    // A fence inside a blockquote, `> \`\`\`python`, opens and closes the same way.
    const unquoted = line.replace(/^(?:\s*>)+/, "");
    const marker = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(unquoted);
    if (marker) {
      const run = marker[1];
      if (fence === null) {
        fence = { char: run[0], length: run.length, language: marker[2].toLowerCase() };
        return;
      }
      if (run[0] === fence.char && run.length >= fence.length && unquoted.trim() === run) {
        fence = null;
        return;
      }
    }
    onLine(line, index, fence !== null, fence?.language ?? "");
  });
}

/**
 * A `#` heading, including one inside a blockquote: the markdown guide shows `> # Title` as an
 * example, and the page renders it as a heading with an id like any other.
 */
const ATX_HEADING = /^(?: {0,3}>\s?)* {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;

/** Every `#` heading of a lesson outside code, with the anchor the rendered page gives it. */
export function lessonHeadings(markdown: string): LessonHeading[] {
  const slug = headingSlugger();
  const headings: LessonHeading[] = [];

  forEachProseLine(markdown, (line) => {
    const match = ATX_HEADING.exec(line);
    if (!match) return;
    const text = headingText(match[2]);
    headings.push({ level: match[1].length, text, anchor: slug(text) });
  });

  return headings;
}

/**
 * The fence languages whose blocks are not code: diagrams, and plain or markdown text. Their words
 * are English — a Mermaid label "Is it raining?", a markdown example's sentences — and stored as
 * code they would match a search for `if` or `for` as though they were a loop.
 */
const NOT_CODE_FENCES = new Set(["mermaid", "text", "txt", "plaintext", "md", "markdown"]);

/** The `inline code` spans of a line of markdown, in order. */
function inlineCode(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)].map((span) => span[1]);
}

/** One stretch of a lesson under a `##` or `###` heading, as search reads it. */
export type LessonSectionText = {
  heading: string;
  anchor: string;
  /** The prose, as plain words. */
  text: string;
  /**
   * The code: the lines of its fenced blocks, then each distinct `inline code` span, its heading's
   * included, one to a line.
   */
  code: string;
  position: number;
};

/**
 * A lesson cut at its `##` and `###` headings, each piece's prose as plain words and its code
 * apart.
 *
 * Search ranks these pieces rather than whole lessons, so a result can link to the heading the
 * words are under. The words before the first `##` — the lesson's introduction — form a piece of
 * their own under the lesson's `#` title.
 *
 * **Prose and code are kept apart because search reads them differently.** In prose and headings,
 * `for`, `if` and `and` are ordinary English — "for example", "if you want" — and search leaves
 * them out; in code they are Python, and search finds them. The code is every line of the
 * section's fenced blocks and every `inline code` span in its prose. GitBook tags and HTML tags are
 * dropped from the prose.
 *
 * **The fenced code comes first, and each inline span once.** A search result's code excerpt is
 * drawn from the first match in the code, so a section whose prose names `for` four times before its
 * loop would otherwise show four lines reading `for` in place of the loop.
 */
export function extractSections(markdown: string): LessonSectionText[] {
  const slug = headingSlugger();
  const sections: LessonSectionText[] = [];
  let current: {
    heading: string;
    anchor: string;
    lines: string[];
    fenced: string[];
    inline: string[];
  } | null = null;

  const close = () => {
    if (current === null) return;
    const text = current.lines
      .map((line) => line.replace(/^\s*#{1,6}\s+/, ""))
      .join("\n")
      .replace(/\{%[^%]*%\}/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const code = [...current.fenced, ...new Set(current.inline)].join("\n").trim();
    if (text !== "" || code !== "" || current.heading !== "") {
      sections.push({
        heading: current.heading,
        anchor: current.anchor,
        text,
        code,
        position: sections.length,
      });
    }
  };

  forEachLine(markdown, (line, _index, inCode, language) => {
    if (inCode) {
      if (current === null)
        current = { heading: "", anchor: "", lines: [], fenced: [], inline: [] };
      // A diagram or a block of plain or markdown text holds English, not code.
      if (!NOT_CODE_FENCES.has(language)) current.fenced.push(line);
      return;
    }
    const match = ATX_HEADING.exec(line);
    if (match) {
      const level = match[1].length;
      const text = headingText(match[2]);
      const anchor = slug(text);
      if (level <= 3) {
        close();
        // A heading's `inline code` is code: "The `while` loop" is about `while`.
        current = { heading: text, anchor, lines: [], fenced: [], inline: inlineCode(match[2]) };
        return;
      }
    }
    if (current === null) current = { heading: "", anchor: "", lines: [], fenced: [], inline: [] };
    current.lines.push(line);
    current.inline.push(...inlineCode(line));
  });
  close();

  return sections;
}

/**
 * `target` read from the folder `fromPath` sits in, as a path from the repository root, or null
 * when it climbs above the root.
 *
 * Written out rather than taken from `node:path`, because the lesson page runs this in the browser.
 * Any `?query` or `#fragment` is the caller's to remove first, and `%20` and the like are decoded,
 * since a path in the repository's tree is stored with its real spaces.
 */
export function resolveRepoPath(fromPath: string, target: string): string | null {
  const parts = target.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);

  let decoded = target;
  try {
    decoded = decodeURI(target);
  } catch {
    // A stray `%` that is not an escape; the path is used as written.
  }

  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/** Whether a link or image address points outside the repository, or is not a path at all. */
export function isExternalAddress(address: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(address) || address.startsWith("//");
}

/**
 * The repository paths of the images a lesson shows from the repository itself.
 *
 * Both forms the lessons use: markdown `![alt](src)` and an HTML `<img src="…">`. Images on other
 * sites are left out, because the sync can only check what is in the repository's tree. The sync
 * reports any path here that the tree lacks, which is how a broken image is found before a fellow
 * opens the page.
 */
export function lessonImagePaths(lessonPath: string, markdown: string): string[] {
  const sources: string[] = [];

  forEachProseLine(markdown, (line) => {
    // `![](<path with spaces.png>)` is how markdown writes a path with spaces, and GitBook writes
    // its uploaded screenshots that way.
    // A path may hold balanced parentheses, as GitBook's `image%20(1).png` names do.
    for (const match of line.matchAll(
      /!\[[^\]]*\]\(\s*(?:<([^>]+)>|((?:[^()\s]|\([^()\s]*\))+))/g,
    )) {
      sources.push(match[1] ?? match[2]);
    }
    for (const match of line.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      sources.push(match[1]);
    }
  });

  const paths = new Set<string>();
  for (const source of sources) {
    if (isExternalAddress(source)) continue;
    const resolved = resolveRepoPath(lessonPath, source.split(/[?#]/)[0]);
    if (resolved) paths.add(resolved);
  }
  return [...paths];
}

/** A line holding one GitBook tag and nothing else, which is the only form `gitbookToHtml` converts. */
export const GITBOOK_TAG_LINE = /^(\s*)(\{%[^%]*%\})\s*$/;

/**
 * The names of the GitBook tags on one line, leaving out any written inside a `code` span, which
 * the page shows as code. A name may hold a hyphen, as `content-ref` does.
 */
function tagNames(line: string): string[] {
  const outsideCode = line.replace(/`[^`]*`/g, "");
  return [...outsideCode.matchAll(/\{%\s*([a-zA-Z][a-zA-Z-]*)/g)].map((match) => match[1]);
}

/** The GitBook block tags the lesson page knows how to draw. */
export const KNOWN_GITBOOK_TAGS = new Set(["hint", "endhint", "code", "endcode", "embed"]);

/**
 * The names of the GitBook `{% tag %}` blocks in a lesson that the lesson page cannot draw.
 *
 * Such a tag would be shown to fellows as literal text. The sync reports it instead, so the first
 * lesson that uses a new kind of block is named on the Lessons page rather than discovered by a
 * fellow.
 */
export function unknownGitbookTags(markdown: string): string[] {
  const names = new Set<string>();
  forEachProseLine(markdown, (line) => {
    for (const name of tagNames(line)) {
      if (!KNOWN_GITBOOK_TAGS.has(name)) names.add(name);
    }
  });
  return [...names];
}

/**
 * The names of known GitBook tags written on a line with other text, such as
 * `{% hint style="info" %}A short note{% endhint %}`.
 *
 * `gitbookToHtml` converts a tag only when it has its line to itself, because a tag sharing a line
 * cannot be given the blank lines around it that keep the markdown inside it readable. Such a tag
 * is shown to fellows as literal text, so the sync reports it.
 */
export function inlineGitbookTags(markdown: string): string[] {
  const names = new Set<string>();
  forEachProseLine(markdown, (line) => {
    if (GITBOOK_TAG_LINE.test(line)) return;
    for (const name of tagNames(line)) {
      if (KNOWN_GITBOOK_TAGS.has(name)) names.add(name);
    }
  });
  return [...names];
}

/**
 * Whether a page holds nothing but its `#` title, as most module `README.md` files do.
 *
 * GitBook shows such a page as its title over a card for each chapter, and the lesson page does
 * the same, rather than a heading over an empty page.
 */
export function hasOnlyTitle(markdown: string): boolean {
  return markdown.split("\n").every((line) => line.trim() === "" || /^ {0,3}#\s/.test(line));
}
