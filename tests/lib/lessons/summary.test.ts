import { lessonSlug, parseSummary, slugFromSegments } from "@/lib/lessons/summary";

/**
 * Reading `SUMMARY.md`. The fixture is cut from the real file at commit 530b2db and keeps each
 * thing the parser has to get right: both bullet characters, pages taken out with a comment on one
 * line and on several, a part heading, and a part with no pages under it.
 */
const SUMMARY = `# Table of contents

* [Welcome](README.md)
* [Guidelines and Policies](guidelines-and-policies/README.md)
  * [Academic Integrity](guidelines-and-policies/academic-integrity.md)
  <!-- * [Loom Setup](environment-setup/loom.md) -->
<!-- * [Project Guides](projects/README.md)
  * [Free API List](projects/4-free-apis.md) -->

## Computational Thinking and Responsible Use of AI

- [1. Python Fundamentals](mod-1-python-fundamentals/README.md)
  - [Overview](mod-1-python-fundamentals/Overview.md)
  - [1.6 Loops](mod-1-python-fundamentals/6-loops.md)

- [2. Object-Oriented Programming](mod-2-oop-python/README.md)
  - [2.1 Intro to OOP, Classes, \`__init__\`, and \`self\`](mod-2-oop-python/1-intro-to-oop-classes-init-self.md)
  - A bullet with no link

## Capstone
`;

describe("parseSummary", () => {
  const entries = parseSummary(SUMMARY);

  it("lists every linked page in order, and nothing that is commented out", () => {
    expect(entries.map((entry) => entry.path)).toEqual([
      "README.md",
      "guidelines-and-policies/README.md",
      "guidelines-and-policies/academic-integrity.md",
      "mod-1-python-fundamentals/README.md",
      "mod-1-python-fundamentals/Overview.md",
      "mod-1-python-fundamentals/6-loops.md",
      "mod-2-oop-python/README.md",
      "mod-2-oop-python/1-intro-to-oop-classes-init-self.md",
    ]);
    expect(entries.map((entry) => entry.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("puts each indented page in the module above it, and a top-level page in its own", () => {
    const loops = entries.find((entry) => entry.path.endsWith("6-loops.md"));
    expect(loops).toMatchObject({
      title: "1.6 Loops",
      modulePath: "mod-1-python-fundamentals/README.md",
      moduleTitle: "1. Python Fundamentals",
    });
    expect(entries[0]).toMatchObject({ modulePath: "README.md", moduleTitle: "Welcome" });
  });

  it("records the part a page sits under, and none before the first part", () => {
    expect(entries[2].partTitle).toBeNull();
    expect(entries[5].partTitle).toBe("Computational Thinking and Responsible Use of AI");
  });

  it("keeps code spans in a title as they are written", () => {
    expect(entries[7].title).toBe("2.1 Intro to OOP, Classes, `__init__`, and `self`");
  });

  it("reads an escaped file name as the file's real name", () => {
    const [entry] = parseSummary("* [Intro](mod-2/Intro%20to%20OOP.md)\n");
    expect(entry.path).toBe("mod-2/Intro to OOP.md");
  });
});

describe("lessonSlug", () => {
  it("drops the extension, and names a README by its folder", () => {
    expect(lessonSlug("mod-1-python-fundamentals/6-loops.md")).toBe(
      "mod-1-python-fundamentals/6-loops",
    );
    expect(lessonSlug("mod-1-python-fundamentals/README.md")).toBe("mod-1-python-fundamentals");
  });

  it("keeps the root README's name, since it has no folder", () => {
    expect(lessonSlug("README.md")).toBe("README");
  });
});

describe("slugFromSegments", () => {
  it("joins the address's segments into a slug, decoding what is escaped", () => {
    expect(slugFromSegments(["mod-2", "Intro%20to%20OOP"])).toBe("mod-2/Intro to OOP");
    expect(slugFromSegments(["100%-coverage"])).toBe("100%-coverage");
  });
});
