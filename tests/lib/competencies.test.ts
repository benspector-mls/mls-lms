/**
 * The two things about the competency list that live in code: which fellowships exist, and how a
 * search prunes a list somebody has been handed.
 *
 * The list itself is rows in three tables, so what is in it is asserted against a database in
 * `tests/integration/competencies.test.ts`. What is here needs no database and is about the rules
 * rather than the content — which is why the fixture below is four lines of invented competencies
 * rather than the school's own.
 */
import {
  DISCIPLINES,
  DISCIPLINE_META,
  ENTRY_KINDS,
  entriesOfKind,
  filterCompetencies,
  type CompetencySection,
} from "@/lib/competencies";

const SECTIONS: CompetencySection[] = [
  {
    id: "durable",
    name: "Durable Skills",
    competencies: [
      {
        id: "growth",
        name: "Growth Mindset",
        blurb: "Deriving satisfaction from growth.",
        entries: [
          { id: "asks", kind: "INDICATOR", text: "Asks for help when stuck." },
          { id: "reflects", kind: "INDICATOR", text: "Reflects on mistakes." },
          { id: "defensive", kind: "PITFALL", text: "Becoming defensive about feedback." },
        ],
      },
      {
        id: "communication",
        name: "Communication",
        blurb: "Saying the thing clearly.",
        entries: [{ id: "writes", kind: "INDICATOR", text: "Writes a clear question." }],
      },
    ],
  },
  {
    id: "technical",
    name: "Software Engineering",
    competencies: [
      {
        id: "debugging",
        name: "Debugging",
        blurb: "",
        entries: [{ id: "isolates", kind: "INDICATOR", text: "Isolates a failure." }],
      },
    ],
  },
];

describe("the fellowships", () => {
  it("every one has a label", () => {
    for (const discipline of DISCIPLINES) {
      expect(DISCIPLINE_META[discipline].label).not.toBe("");
    }
  });

  it("names both kinds of entry", () => {
    expect([...ENTRY_KINDS]).toEqual(["INDICATOR", "PITFALL"]);
  });
});

describe("entriesOfKind", () => {
  const growth = SECTIONS[0]!.competencies[0]!;

  it("keeps one kind, in the order they were given", () => {
    expect(entriesOfKind(growth, "INDICATOR").map((entry) => entry.id)).toEqual([
      "asks",
      "reflects",
    ]);
    expect(entriesOfKind(growth, "PITFALL").map((entry) => entry.id)).toEqual(["defensive"]);
  });
});

describe("filterCompetencies", () => {
  it("a blank query is the whole list", () => {
    expect(filterCompetencies("", SECTIONS)).toBe(SECTIONS);
    expect(filterCompetencies("   ", SECTIONS)).toBe(SECTIONS);
  });

  it("keeps the entries that match, and drops what is left empty", () => {
    const found = filterCompetencies("defensive", SECTIONS);

    expect(found).toHaveLength(1);
    expect(found[0]!.competencies).toHaveLength(1);
    expect(found[0]!.competencies[0]!.entries.map((entry) => entry.id)).toEqual(["defensive"]);
  });

  /*
    Somebody typing a competency's name wants the competency, not the subset of its lines that
    repeat the words back — which for "Growth Mindset" would be none of them.
  */
  it("a competency's own name keeps everything under it", () => {
    const found = filterCompetencies("growth mind", SECTIONS);

    expect(found[0]!.competencies[0]!.entries).toHaveLength(3);
  });

  it("a section's name keeps every competency in it", () => {
    const found = filterCompetencies("software engineering", SECTIONS);

    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe("Software Engineering");
    expect(found[0]!.competencies[0]!.entries).toHaveLength(1);
  });

  it("ignores case", () => {
    expect(filterCompetencies("ISOLATES", SECTIONS)).toHaveLength(1);
  });

  it("a query nothing matches is an empty list rather than empty headings", () => {
    expect(filterCompetencies("kubernetes", SECTIONS)).toEqual([]);
  });

  it("leaves the list it was given alone", () => {
    filterCompetencies("defensive", SECTIONS);

    expect(SECTIONS[0]!.competencies[0]!.entries).toHaveLength(3);
    expect(SECTIONS).toHaveLength(2);
  });
});
