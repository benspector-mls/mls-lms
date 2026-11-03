import {
  DETAIL_FLAGS,
  groupFigures,
  skillFigures,
  skillHistory,
  skillShare,
  WRITING_SKILL,
  type SkillEvidence,
} from "@/lib/skills";

/**
 * What a graded section is evidence of, and how the evidence adds up.
 *
 * The rule is small and every clause of it is a decision somebody could reasonably have made the
 * other way, so each is held here: a section counts toward the skill its declaration names and
 * toward nothing when it names none or names one outside the taxonomy, the proofreading count is
 * per short response and sits on Technical Writing alone, and nothing is colored, banded, or held
 * back under a minimum.
 */

const skills = [
  { id: "py", canonicalId: "python-programming" },
  { id: "tw", canonicalId: WRITING_SKILL },
  { id: "rt", canonicalId: "reading-a-traceback" },
  { id: "sr", canonicalId: "self-reflection" },
];

const base = {
  studentId: "s",
  assignmentId: "a1",
  assignmentTitle: "Loops",
  courseId: "course",
  submissionId: "sub-1",
  dueAt: new Date("2026-09-10T00:00:00Z"),
  sectionType: "Reflection",
  flags: [] as string[],
};

const section = (skillId: string | null, earned: number | null, possible = 3): SkillEvidence => ({
  ...base,
  skillId,
  scoreEarned: earned,
  scorePossible: possible,
});

describe("skillFigures", () => {
  it("counts each section toward the skill its declaration names", () => {
    const evidence = [section("py", 3), section("py", 2), section("tw", 2)];
    const figures = skillFigures(evidence, skills);
    expect(figures.get("py")).toEqual({
      earned: 5,
      possible: 6,
      sections: 2,
      flagged: 0,
      flaggable: 0,
    });
    expect(figures.get("tw")).toMatchObject({ earned: 2, possible: 3, sections: 1 });
  });

  it("counts a section that names no skill, or a skill outside the taxonomy, toward nothing", () => {
    const evidence = [section(null, 9, 10), section("other-discipline", 9, 10)];
    const figures = skillFigures(evidence, skills);
    for (const figure of figures.values()) expect(figure.sections).toBe(0);
  });

  it("skips a section with no score and keeps the rest", () => {
    const evidence = [section("rt", null), section("rt", 1)];
    expect(skillFigures(evidence, skills).get("rt")).toMatchObject({
      earned: 1,
      possible: 3,
      sections: 1,
    });
  });

  it("counts flagged assignments among those with a Technical Writing section, on that figure only", () => {
    const second = { ...base, assignmentId: "a2", assignmentTitle: "Scope" };
    const evidence: SkillEvidence[] = [
      // The round's flags sit on every section of the round; one assignment is one thing flagged.
      { ...section("rt", 3), flags: ["UNDERSTANDING", "MECHANICAL"] },
      { ...section("tw", 1), flags: ["UNDERSTANDING", "MECHANICAL"] },
      { ...second, skillId: "rt", scoreEarned: 3, scorePossible: 3 },
      { ...second, skillId: "tw", scoreEarned: 3, scorePossible: 3 },
      // Flagged, but with no section toward Technical Writing: not counted either way.
      { ...section("py", 3), assignmentId: "a3", flags: ["MARKDOWN"] },
    ];
    const figures = skillFigures(evidence, skills);
    expect(figures.get("tw")).toMatchObject({ flagged: 1, flaggable: 2 });
    expect(figures.get("rt")).toMatchObject({ flagged: 0, flaggable: 0 });
    expect(figures.get("py")).toMatchObject({ flagged: 0, flaggable: 0 });
  });

  it("sums a group's skills into one figure, carrying the flag counts", () => {
    const figures = skillFigures(
      [section("py", 2), section("rt", 1), { ...section("tw", 3), flags: ["MARKDOWN"] }],
      skills,
    );
    const groups = groupFigures(figures, [
      { id: "g1", skills: [{ id: "py" }, { id: "rt" }] },
      { id: "g2", skills: [{ id: "tw" }, { id: "sr" }] },
    ]);
    expect(groups.get("g1")).toEqual({ earned: 3, possible: 6, sections: 2, flagged: 0, flaggable: 0 });
    expect(groups.get("g2")).toEqual({ earned: 3, possible: 3, sections: 1, flagged: 1, flaggable: 1 });
  });

  it("gives every skill an entry, with nothing behind it when nothing counts", () => {
    const figures = skillFigures([], skills);
    expect([...figures.keys()].sort()).toEqual(skills.map((skill) => skill.id).sort());
  });

  it("rounds half points added in floating point", () => {
    const evidence = [section("py", 0.1, 1), section("py", 0.2, 1)];
    expect(skillFigures(evidence, skills).get("py")).toMatchObject({ earned: 0.3, possible: 2 });
  });
});

describe("skillHistory", () => {
  it("lists one line per contributing section, oldest due date first", () => {
    const evidence: SkillEvidence[] = [
      {
        ...section("py", 3),
        assignmentId: "a2",
        assignmentTitle: "Scope",
        submissionId: "sub-2",
        dueAt: new Date("2026-09-17T00:00:00Z"),
      },
      { ...section("tw", 2), flags: ["MARKDOWN"] },
      section("rt", 1),
      section(null, 5, 5),
    ];
    const lines = skillHistory(evidence, skills);
    expect(lines.map((line) => [line.assignmentTitle, line.skillId, line.earned, line.flagged])).toEqual([
      ["Loops", "tw", 2, true],
      ["Loops", "rt", 1, false],
      ["Scope", "py", 3, false],
    ]);
    expect(lines[0]).toMatchObject({ courseId: "course", submissionId: "sub-1", possible: 3 });
    expect(lines[2]).toMatchObject({ submissionId: "sub-2" });
  });
});

describe("skillShare", () => {
  it("is earned over possible, and null with nothing behind it", () => {
    expect(skillShare({ earned: 3, possible: 4, sections: 1, flagged: 0, flaggable: 0 })).toBe(
      0.75,
    );
    expect(skillShare({ earned: 0, possible: 0, sections: 0, flagged: 0, flaggable: 0 })).toBe(
      null,
    );
  });
});

describe("DETAIL_FLAGS", () => {
  it("names the two writing flags that are slips of attention", () => {
    expect([...DETAIL_FLAGS]).toEqual(["MECHANICAL", "MARKDOWN"]);
  });
});
