/**
 * Reading the curriculum's table of contents, `SUMMARY.md`, into the ordered list of lessons the
 * LMS shows.
 *
 * **Only what the summary links becomes a lesson.** The curriculum repository holds many markdown
 * files that no reader of GitBook can reach — drafts, old modules, planning notes — and the
 * summary is the one place that says which files are the course. Reading it is what keeps those
 * files out of the LMS without a second list to maintain.
 *
 * Pure, with no GitHub import, so its tests need nothing.
 */

/** One linked entry of the summary, in the order the summary lists it. */
export type SummaryEntry = {
  /** The file's path from the repository root, such as `mod-1-python-fundamentals/6-loops.md`. */
  path: string;
  /** The link text, which is the title the summary gives the page. May contain `code` spans. */
  title: string;
  /** The `##` heading the entry sits under, or null for the entries before the first one. */
  partTitle: string | null;
  /** The top-level entry this one belongs to. A top-level entry belongs to itself. */
  modulePath: string;
  moduleTitle: string;
  /** Zero-based order in the summary. */
  position: number;
};

/** A bullet holding a link: its indentation, its text and its target. */
const LINK_ENTRY = /^(\s*)[*-]\s+\[(.+)\]\(([^)\s]+)\)\s*$/;
const PART_HEADING = /^##\s+(.+?)\s*$/;

/**
 * Every linked entry of `SUMMARY.md`, in order.
 *
 * The rules, which are the ones GitBook reads the file by:
 *
 * - an `## Heading` line starts a part, and entries before the first one have no part;
 * - a link bullet with no indentation starts a module, and is itself a page;
 * - an indented link bullet is a page of the module above it;
 * - anything inside `<!-- -->` is ignored, which is how the authors take a page out of the course
 *   without deleting its file;
 * - a bullet without a link, and the `#` title line, are ignored.
 *
 * Both bullet characters appear in the real file, `*` in the first half and `-` in the second.
 */
export function parseSummary(text: string): SummaryEntry[] {
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, "");
  const entries: SummaryEntry[] = [];

  let partTitle: string | null = null;
  let currentModule: { path: string; title: string } | null = null;

  for (const line of withoutComments.split("\n")) {
    const part = PART_HEADING.exec(line);
    if (part) {
      partTitle = part[1];
      currentModule = null;
      continue;
    }

    const link = LINK_ENTRY.exec(line);
    if (!link) continue;

    const [, indent, title, target] = link;
    // A file name with a space is written escaped, `Intro%20to%20OOP.md`, and the tree holds it
    // with its real space; a stray `%` that is no escape leaves the path as written.
    let path = target.replace(/^\.\//, "");
    try {
      path = decodeURI(path);
    } catch {
      // Used as written.
    }

    if (indent.length === 0 || currentModule === null) currentModule = { path, title };

    entries.push({
      path,
      title,
      partTitle,
      modulePath: currentModule.path,
      moduleTitle: currentModule.title,
      position: entries.length,
    });
  }

  return entries;
}

/**
 * The address segment for a lesson, which is also the key every record about a fellow's reading
 * attaches to.
 *
 * The path without `.md`, so `mod-1-python-fundamentals/6-loops.md` is
 * `mod-1-python-fundamentals/6-loops`. A module's `README.md` is named by its folder, the way
 * GitBook names it. The repository's own root `README.md` has no folder, so it keeps its file name.
 */
export function lessonSlug(path: string): string {
  const withoutExtension = path.replace(/\.md$/i, "");
  if (withoutExtension === "README") return "README";
  return withoutExtension.replace(/\/README$/, "");
}

/**
 * The slug a lesson's address names, from the address's segments after `/lessons/`. Each segment
 * is decoded where it is still escaped and used as it is where it is not, so a file name holding a
 * `%` cannot make the page or its breadcrumbs fail.
 */
export function slugFromSegments(segments: string[]): string {
  return segments
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}
