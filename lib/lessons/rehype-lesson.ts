/**
 * The last step of drawing a lesson: heading ids, and every link and image address made to work
 * outside GitBook.
 *
 * The lessons were written to be read on GitBook, inside the repository's own folder layout. A link
 * such as `../mod-1-python-fundamentals/6-loops.md#while-loops` and an image such as
 * `../.gitbook/assets/local-git.png` are paths in that layout, and neither means anything at an
 * LMS address. This rewrites each one:
 *
 * - a link to another lesson goes to that lesson's page in the same course, `<lessonsBase>/<slug>#anchor`;
 * - a link to any other file in the repository opens that file on GitHub, at the commit the lesson
 *   was copied from;
 * - an image is loaded from `raw.githubusercontent.com` at that same commit, so the picture always
 *   comes from the same version of the lesson as the words around it;
 * - a link to another site opens in a new tab, and a link to `#anchor` stays on the page.
 *
 * **Heading ids are set here rather than by a plugin,** with `headingSlugger`, because the sync
 * stores each section's anchor with that same function. A search result's link and the heading it
 * lands on can then never disagree.
 *
 * Runs after `rehype-sanitize`, so the addresses it writes are not re-checked, and every one it
 * writes is built from the repository name, a commit and a path rather than copied from the lesson.
 *
 * Pure, with type-only imports, so its tests can hand it a tree built by hand.
 */

import { headingSlugger, isExternalAddress, resolveRepoPath } from "./outline";

/** The parts of a rendered node this plugin reads and writes. */
type RenderedNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: RenderedNode[];
  properties?: Record<string, unknown>;
};

export type LessonLinkOptions = {
  /** The lesson's path in the repository, which relative addresses are read from. */
  lessonPath: string;
  /** `owner/repo`. */
  repo: string;
  /** The commit the lesson was copied from. */
  commitSha: string;
  /**
   * Where this course's lessons are addressed, such as `/courses/<id>/lessons`, which differs
   * between the fellow's side and the instructor's. A string rather than a function, because the
   * page builds these options on the server and hands them to a component in the browser.
   */
  lessonsBase: string;
  /** Every lesson's repository path, mapped to its slug. */
  slugsByPath: Record<string, string>;
};

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function textOf(node: RenderedNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** Each segment escaped, so a file name with a space or a `#` is still one path. */
function encodedPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Where a link in a lesson should go, given its address as the author wrote it. */
export function lessonLinkTarget(href: string, options: LessonLinkOptions): string {
  if (href.startsWith("#") || isExternalAddress(href)) return href;

  const hashAt = href.indexOf("#");
  const target = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const path = resolveRepoPath(options.lessonPath, target.split("?")[0]);
  if (path === null) return href;

  // A link to a folder means the folder's README, the way GitBook reads it.
  const slug =
    options.slugsByPath[path] ??
    options.slugsByPath[path === "" ? "README.md" : `${path.replace(/\/$/, "")}/README.md`];
  if (slug !== undefined) return `${options.lessonsBase}/${slug}${hash}`;

  return `https://github.com/${options.repo}/blob/${options.commitSha}/${encodedPath(path)}${hash}`;
}

/** Where an image in a lesson should load from, given its address as the author wrote it. */
export function lessonImageSrc(src: string, options: LessonLinkOptions): string {
  if (isExternalAddress(src)) return src;
  const path = resolveRepoPath(options.lessonPath, src.split(/[?#]/)[0]);
  if (path === null) return src;
  return `https://raw.githubusercontent.com/${options.repo}/${options.commitSha}/${encodedPath(path)}`;
}

/**
 * Each top-level `##` heading and everything after it up to the next one, wrapped in a `<section>`.
 *
 * The page keeps the heading of the section being read stuck at the top of the screen. A sticky
 * element stays stuck until the end of the element that contains it, so without a section of its
 * own every heading would stay stuck to the end of the lesson, piled under the later ones — and a
 * one-line heading over a two-line one leaves the second line showing. In its own section, each
 * heading is pushed away by the next. Whatever comes before the first `##` stays as it is.
 *
 * **The heading's id moves to its section.** A jump scrolls to where its target is drawn, and a
 * stuck heading is drawn wherever it is stuck — at the end of its section when the reader is
 * further down, or at the top of the screen when it is the current one — so a jump to it would
 * land at the wrong place. The section is never stuck, and it starts where the heading starts.
 */
export function wrapSections(tree: RenderedNode): void {
  const children: RenderedNode[] = [];
  let section: RenderedNode | null = null;

  for (const child of tree.children ?? []) {
    if (child.type === "element" && child.tagName === "h2") {
      const { id, ...rest } = child.properties ?? {};
      child.properties = rest;
      section = {
        type: "element",
        tagName: "section",
        properties: id === undefined ? {} : { id },
        children: [child],
      };
      children.push(section);
    } else if (section) {
      section.children!.push(child);
    } else {
      children.push(child);
    }
  }

  tree.children = children;
}

export function rehypeLesson(options: LessonLinkOptions) {
  return (tree: RenderedNode) => {
    const slug = headingSlugger();

    const visit = (node: RenderedNode) => {
      if (node.type === "element" && node.tagName) {
        const properties = (node.properties ??= {});

        if (HEADINGS.has(node.tagName)) {
          properties.id = slug(textOf(node));
        } else if (node.tagName === "a" && typeof properties.href === "string") {
          const href = lessonLinkTarget(properties.href, options);
          properties.href = href;
          if (isExternalAddress(href)) {
            properties.target = "_blank";
            properties.rel = "noreferrer";
          }
        } else if (node.tagName === "img" && typeof properties.src === "string") {
          properties.src = lessonImageSrc(properties.src, options);
        }
      }
      node.children?.forEach(visit);
    };

    visit(tree);
    wrapSections(tree);
  };
}
