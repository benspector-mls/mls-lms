import { rehypeLesson, wrapSections, type LessonLinkOptions } from "@/lib/lessons/rehype-lesson";

/**
 * The step that makes a lesson's GitBook paths work at LMS addresses. The trees are built by hand
 * in the shape `rehype-raw` hands on: elements with `properties`, text nodes with `value`.
 */

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  children?: Node[];
  properties?: Record<string, unknown>;
};

const SHA = "530b2db0000000000000000000000000000000aa";

const options: LessonLinkOptions = {
  lessonPath: "mod-0-command-line-interfaces-git-and-github/2-git-github.md",
  repo: "The-Marcy-Lab-School/marcy-curriculum-docs-swe-python",
  commitSha: SHA,
  lessonsBase: "/courses/c1/lessons",
  slugsByPath: {
    "mod-1-python-fundamentals/6-loops.md": "mod-1-python-fundamentals/6-loops",
    "mod-1-python-fundamentals/README.md": "mod-1-python-fundamentals",
  },
};

function element(
  tagName: string,
  properties: Record<string, unknown>,
  children: Node[] = [],
): Node {
  return { type: "element", tagName, properties, children };
}

function text(value: string): Node {
  return { type: "text", value };
}

function run(...children: Node[]): Node[] {
  const tree: Node = { type: "root", children };
  rehypeLesson(options)(tree);
  return children;
}

describe("rehypeLesson", () => {
  it("gives headings the ids the lessons link to, numbering repeats", () => {
    const second = element("h3", {}, [text("Summary")]);
    const tree: Node = {
      type: "root",
      children: [
        element("h2", {}, [text("Summary")]),
        second,
        element("h2", {}, [text("The "), element("code", {}, [text("for")]), text(" loop")]),
      ],
    };
    rehypeLesson(options)(tree);

    // A `##` heading's id is carried by the section wrapped around it; see `wrapSections`.
    expect(tree.children?.map((section) => section.properties?.id)).toEqual([
      "summary",
      "the-for-loop",
    ]);
    expect(second.properties?.id).toBe("summary-1");
  });

  it("sends a link to another lesson to that lesson's page, keeping its anchor", () => {
    const [link] = run(
      element("a", { href: "../mod-1-python-fundamentals/6-loops.md#while-loops" }),
    );
    expect(link.properties).toEqual({
      href: "/courses/c1/lessons/mod-1-python-fundamentals/6-loops#while-loops",
    });
  });

  it("reads a link to a folder as that folder's README", () => {
    const [link] = run(element("a", { href: "../mod-1-python-fundamentals/" }));
    expect(link.properties?.href).toBe("/courses/c1/lessons/mod-1-python-fundamentals");
  });

  it("opens a link to a file that is not a lesson on GitHub, at the lesson's commit", () => {
    const [link] = run(element("a", { href: "../scripts/setup file.sh" }));
    expect(link.properties).toEqual({
      href: `https://github.com/The-Marcy-Lab-School/marcy-curriculum-docs-swe-python/blob/${SHA}/scripts/setup%20file.sh`,
      target: "_blank",
      rel: "noreferrer",
    });
  });

  it("opens another site in a new tab and leaves an in-page anchor alone", () => {
    const [outside, anchor] = run(
      element("a", { href: "https://docs.python.org" }),
      element("a", { href: "#key-terms" }),
    );
    expect(outside.properties).toEqual({
      href: "https://docs.python.org",
      target: "_blank",
      rel: "noreferrer",
    });
    expect(anchor.properties).toEqual({ href: "#key-terms" });
  });

  it("loads a repository image from raw.githubusercontent.com at the lesson's commit", () => {
    const [image, outside] = run(
      element("img", { src: "../.gitbook/assets/local git.png", alt: "" }),
      element("img", { src: "https://example.com/a.png" }),
    );
    expect(image.properties?.src).toBe(
      `https://raw.githubusercontent.com/The-Marcy-Lab-School/marcy-curriculum-docs-swe-python/${SHA}/.gitbook/assets/local%20git.png`,
    );
    expect(outside.properties?.src).toBe("https://example.com/a.png");
  });

  it("rewrites links and images nested inside other elements", () => {
    const image = element("img", { src: "img/a.png" });
    run(element("details", {}, [element("p", {}, [image])]));
    expect(image.properties?.src).toBe(
      `https://raw.githubusercontent.com/The-Marcy-Lab-School/marcy-curriculum-docs-swe-python/${SHA}/mod-0-command-line-interfaces-git-and-github/img/a.png`,
    );
  });
});

describe("wrapSections", () => {
  it("wraps each top-level ## heading with what follows it, and leaves the introduction alone", () => {
    const title = element("h1", {}, [text("Loops")]);
    const intro = element("p", {}, [text("Iteration.")]);
    const first = element("h2", {}, [text("For")]);
    const body = element("p", {}, [text("A for loop.")]);
    const sub = element("h3", {}, [text("Range")]);
    const second = element("h2", {}, [text("While")]);
    const tree: Node = { type: "root", children: [title, intro, first, body, sub, second] };

    wrapSections(tree);

    expect(tree.children).toEqual([
      title,
      intro,
      { type: "element", tagName: "section", properties: {}, children: [first, body, sub] },
      { type: "element", tagName: "section", properties: {}, children: [second] },
    ]);
  });

  it("moves each heading's id to its section, which is never stuck", () => {
    const heading = element("h2", { id: "while-loops" }, [text("While Loops")]);
    const tree: Node = { type: "root", children: [heading] };

    wrapSections(tree);

    expect(tree.children?.[0]).toMatchObject({
      tagName: "section",
      properties: { id: "while-loops" },
    });
    expect(heading.properties).toEqual({});
  });
});
