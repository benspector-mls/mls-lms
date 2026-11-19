/**
 * The lessons: curricula registered by admins, copied from GitHub, chosen per course, and read
 * through the course.
 *
 * Run with `npm run test:integration`.
 *
 * The sync's GitHub reads are replaced with a repository held in this file, so each case names
 * exactly what the curriculum holds and the rest of the sync — the rows, the sections, the
 * generated search column, the removals and the problems — runs against the real database.
 */
import { headSha, listTree, readText } from "@/lib/lessons/repo";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import {
  addInstructor,
  makeAccount,
  makeCourse,
  makeProgram,
  makeWorld,
  type World,
} from "./fixtures";
import { withRollback, type Tx } from "./transaction";

jest.mock("../../lib/lessons/repo", () => ({
  ...jest.requireActual("../../lib/lessons/repo"),
  curriculumRepo: jest.fn(async (curriculum: { repo: string; ref: string | null }) => ({
    owner: "The-Marcy-Lab-School",
    repo: curriculum.repo.split("/")[1],
    fullName: curriculum.repo,
    ref: curriculum.ref,
    installationId: 1,
  })),
  headSha: jest.fn(),
  listTree: jest.fn(),
  readText: jest.fn(),
}));

const head = headSha as jest.MockedFunction<typeof headSha>;
const tree = listTree as jest.MockedFunction<typeof listTree>;
const read = readText as jest.MockedFunction<typeof readText>;

const factory = createCallerFactory(appRouter);
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

/** The curriculum at one commit: its files, each with a hash that changes when its text does. */
function serve(sha: string, files: Record<string, string>) {
  head.mockResolvedValue(sha);
  tree.mockResolvedValue(
    new Map(Object.entries(files).map(([path, text]) => [path, `blob-of-${text.length}-${text}`])),
  );
  read.mockImplementation(async (_source, _sha, path) => files[path] ?? null);
}

const SUMMARY = `# Table of contents

* [Welcome](README.md)

## Computational Thinking

- [1. Python Fundamentals](mod-1/README.md)
  - [1.6 Loops](mod-1/6-loops.md)
  - [1.7 Lists](mod-1/7-lists.md)
`;

const LOOPS = `# 1.6 Loops

{% hint style="info" %}
Iteration is the repetition of a process.
{% endhint %}

## While Loops

A while loop repeats until its condition is false. Use \`break\` to stop early.

\`\`\`python
while count < 3:
    count += 1
\`\`\`

\`\`\`mermaid
flowchart TD
  A{Is it for each item?}
\`\`\`

![](../.gitbook/assets/missing.png)

{% tabs %}
`;

const FILES = {
  "SUMMARY.md": SUMMARY,
  "README.md": "---\ncover: a.png\n---\n# Welcome\n",
  "mod-1/README.md": "# 1. Python Fundamentals\n",
  "mod-1/6-loops.md": LOOPS,
  // 7-lists.md is listed and missing.
};

/** The same curriculum one commit later: the welcome page dropped and 1.6 Loops edited. */
const EDITED = {
  ...FILES,
  "SUMMARY.md": SUMMARY.replace("* [Welcome](README.md)\n", ""),
  "mod-1/6-loops.md": `${LOOPS}\nOne more line.\n`,
};

beforeEach(() => {
  head.mockReset();
  tree.mockReset();
  read.mockReset();
});

/** A curriculum with lessons written directly, for the groups about reading rather than copying. */
async function makeCurriculum(tx: Tx, name: string, slugs: string[], removed: string[] = []) {
  const curriculum = await tx.curriculum.create({
    data: { name, repo: `The-Marcy-Lab-School/${name.toLowerCase()}` },
  });
  await tx.lesson.createMany({
    data: [...slugs, ...removed].map((slug, position) => ({
      curriculumId: curriculum.id,
      slug,
      path: `${slug}.md`,
      title: slug,
      moduleSlug: slug.split("/")[0],
      moduleTitle: "Module",
      position,
      body: `# ${slug}`,
      blobSha: "blob",
      commitSha: "c0ffee",
      syncedAt: new Date(),
      removedAt: removed.includes(slug) ? new Date() : null,
    })),
  });
  return curriculum;
}

describe("reading a course's lessons", () => {
  const tx = withRollback();
  let world: World;
  let outsider: string;
  let otherCourseId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    const software = await makeCurriculum(
      tx(),
      "Software",
      ["mod-1", "mod-1/6-loops"],
      ["mod-1/old"],
    );
    await makeCurriculum(tx(), "Analytics", ["sql/1-select"]);
    await tx().course.update({
      where: { id: world.courseId },
      data: { curriculumId: software.id },
    });

    // A second course of the same program, with no curriculum.
    otherCourseId = (await makeCourse(tx(), { programId: world.programId })).id;

    outsider = await makeAccount(tx(), { role: "INSTRUCTOR" });
    const otherProgram = await makeProgram(tx());
    await addInstructor(tx(), { programId: otherProgram.id, userId: outsider });
  });

  it("lists the course's curriculum in summary order, without the removed lesson", async () => {
    const result = await createCaller(tx(), world.student.studentId).lessons.tree({
      courseId: world.courseId,
    });
    expect(result?.curriculum.name).toBe("Software");
    expect(result?.lessons.map((lesson) => lesson.slug)).toEqual(["mod-1", "mod-1/6-loops"]);
  });

  it("opens a lesson of the course's curriculum, and a removed one still opens", async () => {
    const fellow = createCaller(tx(), world.student.studentId);
    await expect(
      fellow.lessons.get({ courseId: world.courseId, slug: "mod-1/6-loops" }),
    ).resolves.toMatchObject({ body: "# mod-1/6-loops", commitSha: "c0ffee", removedAt: null });

    const removed = await fellow.lessons.get({ courseId: world.courseId, slug: "mod-1/old" });
    expect(removed.removedAt).toBeInstanceOf(Date);
  });

  it("answers NOT_FOUND for another curriculum's lesson and for a slug that is no lesson", async () => {
    const fellow = createCaller(tx(), world.student.studentId);
    expect(
      await refusal(() => fellow.lessons.get({ courseId: world.courseId, slug: "sql/1-select" })),
    ).toBe("NOT_FOUND");
    expect(
      await refusal(() => fellow.lessons.get({ courseId: world.courseId, slug: "nope" })),
    ).toBe("NOT_FOUND");
  });

  it("shows no lessons for a course without a curriculum", async () => {
    const result = await createCaller(tx(), world.student.studentId).lessons.tree({
      courseId: otherCourseId,
    });
    expect(result).toBeNull();
  });

  it("lets the program's instructor read them, and refuses an instructor of another program", async () => {
    await expect(
      createCaller(tx(), world.instructorId).lessons.tree({ courseId: world.courseId }),
    ).resolves.not.toBeNull();
    expect(
      await refusal(() => createCaller(tx(), outsider).lessons.tree({ courseId: world.courseId })),
    ).toBe("FORBIDDEN");
  });
});

describe("a course's lessons before it is published", () => {
  const tx = withRollback();

  it("are NOT_FOUND to a fellow, as the course is", async () => {
    const world = await makeWorld(tx(), { published: false });
    const curriculum = await makeCurriculum(tx(), "Hidden", ["mod-1"]);
    await tx().course.update({
      where: { id: world.courseId },
      data: { curriculumId: curriculum.id },
    });

    expect(
      await refusal(() =>
        createCaller(tx(), world.student.studentId).lessons.tree({ courseId: world.courseId }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("choosing a course's curriculum", () => {
  const tx = withRollback();
  let world: World;
  let outsider: string;
  let curriculumId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    curriculumId = (await makeCurriculum(tx(), "Chosen", ["mod-1"])).id;
    outsider = await makeAccount(tx(), { role: "INSTRUCTOR" });
    const otherProgram = await makeProgram(tx());
    await addInstructor(tx(), { programId: otherProgram.id, userId: outsider });
  });

  it("lets the program's instructor choose one, and refuses an instructor of another program", async () => {
    await createCaller(tx(), world.instructorId).courses.setCurriculum({
      courseId: world.courseId,
      curriculumId,
    });
    const course = await tx().course.findUnique({ where: { id: world.courseId } });
    expect(course?.curriculumId).toBe(curriculumId);

    expect(
      await refusal(() =>
        createCaller(tx(), outsider).courses.setCurriculum({
          courseId: world.courseId,
          curriculumId: null,
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("carries the choice into a course copied from this one", async () => {
    const copy = await createCaller(tx(), world.instructorId).courses.create({
      programId: world.programId,
      name: "Next year's course",
      copyFromCourseId: world.courseId,
    });
    const created = await tx().course.findUnique({ where: { id: copy.course.id } });
    expect(created?.curriculumId).toBe(curriculumId);
  });

  it("refuses to remove a curriculum a course shows", async () => {
    const admin = await makeAccount(tx(), { role: "ADMIN" });
    expect(await refusal(() => createCaller(tx(), admin).curricula.remove({ curriculumId }))).toBe(
      "PRECONDITION_FAILED",
    );
  });
});

describe("an admin managing curricula", () => {
  const tx = withRollback();
  let admin: string;
  let instructor: string;
  let curriculum: { id: string };
  let other: { id: string };

  beforeAll(async () => {
    admin = await makeAccount(tx(), { role: "ADMIN" });
    instructor = await makeAccount(tx(), { role: "INSTRUCTOR" });
    curriculum = await createCaller(tx(), admin).curricula.create({
      name: "Software Engineering",
      repo: "The-Marcy-Lab-School/swe",
    });
    other = await makeCurriculum(tx(), "Untouched", ["README"]);
  });

  it("lets an instructor read the list and refuses them every change", async () => {
    const caller = createCaller(tx(), instructor);
    const list = await caller.curricula.list();
    expect(list.map((row) => row.name)).toEqual(
      expect.arrayContaining(["Software Engineering", "Untouched"]),
    );
    expect(await refusal(() => caller.curricula.create({ name: "X", repo: "a/b" }))).toBe(
      "FORBIDDEN",
    );
    expect(await refusal(() => caller.curricula.sync({ curriculumId: curriculum.id }))).toBe(
      "FORBIDDEN",
    );
    expect(await refusal(() => caller.curricula.remove({ curriculumId: other.id }))).toBe(
      "FORBIDDEN",
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("copies every listed page with its sections, and touches no other curriculum", async () => {
    serve("sha-one", FILES);
    const result = await createCaller(tx(), admin).curricula.sync({ curriculumId: curriculum.id });

    expect(result).toMatchObject({ commitSha: "sha-one", lessons: 3, changed: 3, removed: 0 });

    const lessons = await tx().lesson.findMany({
      where: { curriculumId: curriculum.id },
      orderBy: { position: "asc" },
      select: { slug: true, moduleSlug: true, partTitle: true, body: true, commitSha: true },
    });
    expect(lessons).toEqual([
      {
        slug: "README",
        moduleSlug: "README",
        partTitle: null,
        body: "# Welcome\n",
        commitSha: "sha-one",
      },
      expect.objectContaining({
        slug: "mod-1",
        moduleSlug: "mod-1",
        partTitle: "Computational Thinking",
      }),
      expect.objectContaining({ slug: "mod-1/6-loops", moduleSlug: "mod-1" }),
    ]);

    // The other curriculum's lesson has the same slug, README, and is left as it was.
    const untouched = await tx().lesson.findMany({ where: { curriculumId: other.id } });
    expect(untouched).toEqual([
      expect.objectContaining({ slug: "README", removedAt: null, commitSha: "c0ffee" }),
    ]);

    // The sync stores a section's code — its fenced block and its inline code, but not the
    // diagram, whose words are English — apart from its prose.
    const whileSection = await tx().lessonSection.findFirst({
      where: { anchor: "while-loops", lesson: { curriculumId: curriculum.id } },
      select: { code: true },
    });
    expect(whileSection?.code).toBe("while count < 3:\n    count += 1\nbreak");

    // The generated column is filled by Postgres from the heading, the code and the prose.
    const found = await tx().$queryRaw<{ anchor: string }[]>`
      select s.anchor from lesson_sections s join lessons l on l.id = s.lesson_id
      where l.curriculum_id = ${curriculum.id}::uuid
        and s.search @@ plainto_tsquery('public.lesson_text', 'repeats condition')`;
    expect(found).toEqual([{ anchor: "while-loops" }]);
  });

  it("names the problems an author should fix", async () => {
    serve("sha-one", FILES);
    const { problems } = await createCaller(tx(), admin).curricula.sync({
      curriculumId: curriculum.id,
    });

    expect(problems).toEqual(
      expect.arrayContaining([
        { path: "mod-1/7-lists.md", message: expect.stringContaining("no file at that path") },
        {
          path: "mod-1/6-loops.md",
          message: expect.stringContaining(".gitbook/assets/missing.png"),
        },
        { path: "mod-1/6-loops.md", message: expect.stringContaining("{% tabs %}") },
      ]),
    );
    expect(problems).toHaveLength(3);
  });

  it("reads again only what changed, and marks a page dropped from the summary as removed", async () => {
    serve("sha-two", EDITED);
    const result = await createCaller(tx(), admin).curricula.sync({ curriculumId: curriculum.id });

    expect(result).toMatchObject({ commitSha: "sha-two", lessons: 2, changed: 1, removed: 1 });
    expect(read.mock.calls.map(([, , path]) => path).sort()).toEqual([
      "SUMMARY.md",
      "mod-1/6-loops.md",
    ]);

    const rows = await tx().lesson.findMany({
      where: { curriculumId: curriculum.id },
      select: { slug: true, commitSha: true, removedAt: true },
    });
    const bySlug = Object.fromEntries(rows.map((row) => [row.slug, row]));
    expect(bySlug["README"].removedAt).toBeInstanceOf(Date);
    // An unchanged page moves to the new commit, so its images load from the same version.
    expect(bySlug["mod-1"]).toMatchObject({ commitSha: "sha-two", removedAt: null });

    const list = await createCaller(tx(), admin).curricula.list();
    expect(list.find((row) => row.id === curriculum.id)?.lastCopy?.commitSha).toBe("sha-two");
  });

  it("writes no row when nothing in the curriculum changed", async () => {
    serve("sha-two", EDITED);
    const select = { slug: true, updatedAt: true } as const;
    const before = await tx().lesson.findMany({ where: { curriculumId: curriculum.id }, select });

    const result = await createCaller(tx(), admin).curricula.sync({ curriculumId: curriculum.id });

    expect(result).toMatchObject({ commitSha: "sha-two", changed: 0, removed: 0 });
    expect(await tx().lesson.findMany({ where: { curriculumId: curriculum.id }, select })).toEqual(
      expect.arrayContaining(before),
    );
    expect(read.mock.calls.map(([, , path]) => path)).toEqual(["SUMMARY.md"]);
  });

  it("changes nothing when the summary cannot be read", async () => {
    serve(
      "sha-three",
      Object.fromEntries(Object.entries(FILES).filter(([path]) => path !== "SUMMARY.md")),
    );
    const listed = { curriculumId: curriculum.id, removedAt: null };
    const before = await tx().lesson.count({ where: listed });

    expect(
      await refusal(() =>
        createCaller(tx(), admin).curricula.sync({ curriculumId: curriculum.id }),
      ),
    ).toBe("PRECONDITION_FAILED");
    expect(await tx().lesson.count({ where: listed })).toBe(before);
  });

  it("removes a curriculum no course shows, with its lessons", async () => {
    await createCaller(tx(), admin).curricula.remove({ curriculumId: other.id });
    expect(await tx().lesson.count({ where: { curriculumId: other.id } })).toBe(0);
  });
});

describe("searching a course's lessons", () => {
  const tx = withRollback();
  let world: World;
  let outsider: string;

  /** A lesson of `curriculumId` holding the sections given, written as the sync writes them. */
  async function lessonWith(
    curriculumId: string,
    slug: string,
    sections: { heading: string; anchor: string; text: string; code?: string }[],
    removed = false,
  ) {
    const lesson = await tx().lesson.create({
      data: {
        curriculumId,
        slug,
        path: `${slug}.md`,
        title: slug,
        moduleSlug: slug.split("/")[0],
        moduleTitle: "1. Python Fundamentals",
        position: 0,
        body: "",
        blobSha: "blob",
        commitSha: "c0ffee",
        syncedAt: new Date(),
        removedAt: removed ? new Date() : null,
      },
    });
    await tx().lessonSection.createMany({
      data: sections.map((section, position) => ({ lessonId: lesson.id, position, ...section })),
    });
  }

  beforeAll(async () => {
    world = await makeWorld(tx());
    const ours = await tx().curriculum.create({ data: { name: "Ours", repo: "o/ours" } });
    const theirs = await tx().curriculum.create({ data: { name: "Theirs", repo: "o/theirs" } });
    await tx().course.update({ where: { id: world.courseId }, data: { curriculumId: ours.id } });

    await lessonWith(ours.id, "mod-1/6-loops", [
      {
        heading: "While Loops",
        anchor: "while-loops",
        text: "A while loop repeats until its condition is false.",
        code: "while count < 3:",
      },
      {
        heading: "For Loops",
        anchor: "for-loops",
        text: "A for loop runs once per element.",
        code: "for letter in word:",
      },
    ]);
    await lessonWith(
      ours.id,
      "mod-1/old",
      [{ heading: "Old", anchor: "old", text: "A while loop repeats in an old lesson." }],
      true,
    );
    await lessonWith(ours.id, "mod-1/4-conditionals", [
      {
        heading: "Combining Conditions with and, or",
        anchor: "combining-conditions",
        text: "Join two comparisons into one test.",
        code: "a and b or not c",
      },
    ]);
    await lessonWith(ours.id, "mod-1/7-lists", [
      {
        heading: "Lists",
        anchor: "lists",
        text: "For example, a list holds items in order.",
      },
      {
        heading: "Counting",
        anchor: "counting",
        text: "Count each item with a loop.",
        code: "for item in items:\n    count += 1",
      },
    ]);
    await lessonWith(ours.id, "mod-6/2-select", [
      {
        heading: "Filtering Rows",
        anchor: "filtering-rows",
        text: "Keep only the rows you want, where it matters.",
        code: "SELECT * FROM users WHERE age > 21;",
      },
    ]);
    await lessonWith(theirs.id, "sql/loops", [
      { heading: "Loops", anchor: "loops", text: "A while loop repeats in another curriculum." },
    ]);

    outsider = await makeAccount(tx(), { role: "INSTRUCTOR" });
    const otherProgram = await makeProgram(tx());
    await addInstructor(tx(), { programId: otherProgram.id, userId: outsider });
  });

  it("finds the section holding the words, in this course's curriculum only, with its anchor", async () => {
    const { sections: results } = await createCaller(tx(), world.student.studentId).lessons.search({
      courseId: world.courseId,
      q: "while repeats",
    });

    expect(results).toEqual([
      expect.objectContaining({
        slug: "mod-1/6-loops",
        heading: "While Loops",
        anchor: "while-loops",
        moduleTitle: "1. Python Fundamentals",
      }),
    ]);
    // The matched words are marked for the page to highlight: "repeats" in the prose, and `while`
    // in the code, where it is Python.
    expect(results[0].snippet).toContain("⟦repeats⟧");
    expect(results[0].codeSnippet).toContain("⟦while⟧");
  });

  it("matches a word by its stem", async () => {
    const { sections: results } = await createCaller(tx(), world.student.studentId).lessons.search({
      courseId: world.courseId,
      q: "loops",
    });
    expect(results.map((result) => result.anchor).sort()).toEqual([
      "counting",
      "for-loops",
      "while-loops",
    ]);
  });

  it("ranks the section whose code holds `for` first in a search for a for loop", async () => {
    const { sections: results } = await createCaller(tx(), world.student.studentId).lessons.search({
      courseId: world.courseId,
      q: "for loop",
    });
    expect(results[0].anchor).toBe("for-loops");
  });

  it("finds `for` in code, and not in a sentence that says for example", async () => {
    const { sections } = await createCaller(tx(), world.student.studentId).lessons.search({
      courseId: world.courseId,
      q: "for",
    });
    const anchors = sections.map((section) => section.anchor);
    expect(anchors).toContain("counting");
    expect(anchors).not.toContain("lists");
    const counting = sections.find((section) => section.anchor === "counting");
    expect(counting?.codeSnippet).toContain("⟦for⟧ item");
  });

  it("answers a question by its words, with the keyword ranking code that holds it first", async () => {
    const { sections } = await createCaller(tx(), world.student.studentId).lessons.search({
      courseId: world.courseId,
      q: "how do I loop with a for",
    });
    // Every section about loops matches; "how", "I" and "a" are not asked for, and `do`, `with`
    // and `for` only rank. The section with `for` in its code comes first, and its excerpt marks it
    // even though the code holds no `with`.
    expect(sections[0].anchor).toBe("for-loops");
    expect(sections.map((section) => section.anchor)).toEqual(
      expect.arrayContaining(["for-loops", "while-loops", "counting"]),
    );
    expect(sections[0].codeSnippet).toContain("⟦for⟧");
  });

  it("finds a SQL word English drops, such as `where`, in code", async () => {
    const { sections } = await createCaller(tx(), world.student.studentId).lessons.search({
      courseId: world.courseId,
      q: "where",
    });
    expect(sections.map((section) => section.anchor)).toEqual(["filtering-rows"]);
  });

  it("searches for `or` as a word rather than reading it as either-or", async () => {
    const { sections } = await createCaller(tx(), world.student.studentId).lessons.search({
      courseId: world.courseId,
      q: "and or",
    });
    expect(sections.map((section) => section.anchor)).toEqual(["combining-conditions"]);
  });

  it("marks the heading of a section that matches through its heading alone", async () => {
    const { sections } = await createCaller(tx(), world.student.studentId).lessons.search({
      courseId: world.courseId,
      q: "combining",
    });
    expect(sections).toEqual([
      expect.objectContaining({
        anchor: "combining-conditions",
        headingMarked: "⟦Combining⟧ Conditions with and, or",
      }),
    ]);
    expect(sections[0].snippet).not.toContain("⟦");
  });

  it("finds nothing in a course with no curriculum", async () => {
    const course = await makeCourse(tx(), { programId: world.programId });
    await expect(
      createCaller(tx(), world.student.studentId).lessons.search({
        courseId: course.id,
        q: "loop",
      }),
    ).resolves.toEqual({ sections: [], more: false });
  });

  it("refuses an instructor of another program", async () => {
    expect(
      await refusal(() =>
        createCaller(tx(), outsider).lessons.search({ courseId: world.courseId, q: "loop" }),
      ),
    ).toBe("FORBIDDEN");
  });
});
