import {
  COMPETENCIES,
  COMPETENCY_GROUPS,
  GROUP_META,
  competencyEntries,
  entryById,
  filterCompetencies,
} from "@/lib/competencies";

/**
 * The competency list is content, and these tests protect its structure rather than its wording.
 *
 * The wording is expected to change — the list is still in development, which is the whole reason
 * it lives in code and every goal copies the text it chose. What must not change out from under a
 * stored goal is the shape: ids stay unique and stay put, every entry is reachable by its id, and
 * every competency offers both something to work toward and something to work away from.
 */

describe("the groups", () => {
  it("names all three, in presentation order", () => {
    expect(COMPETENCY_GROUPS).toEqual([
      "DURABLE_SKILLS",
      "LEADERSHIP_DEVELOPMENT",
      "SOFTWARE_ENGINEERING",
    ]);
  });

  it("labels every group", () => {
    for (const group of COMPETENCY_GROUPS) {
      expect(GROUP_META[group].label.length).toBeGreaterThan(0);
    }
  });

  it("orders the competencies by group, groups in their declared order", () => {
    const groupOrder = COMPETENCIES.map((competency) =>
      COMPETENCY_GROUPS.indexOf(competency.group),
    );
    expect(groupOrder).toEqual([...groupOrder].sort((a, b) => a - b));
  });
});

describe("the competencies", () => {
  it("holds all eighteen from the source document", () => {
    expect(COMPETENCIES).toHaveLength(18);
    expect(COMPETENCIES.filter((c) => c.group === "DURABLE_SKILLS")).toHaveLength(8);
    expect(COMPETENCIES.filter((c) => c.group === "LEADERSHIP_DEVELOPMENT")).toHaveLength(5);
    expect(COMPETENCIES.filter((c) => c.group === "SOFTWARE_ENGINEERING")).toHaveLength(5);
  });

  it("gives each a slug id, a name, and a one-line definition", () => {
    for (const competency of COMPETENCIES) {
      expect(competency.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(competency.name.length).toBeGreaterThan(0);
      expect(competency.blurb.length).toBeGreaterThan(0);
    }
  });

  /*
    A goal is an agreement to work toward an indicator or away from a pitfall, so a competency
    with either list empty would be one the picker offers nothing under.
  */
  it("gives each at least one indicator and one pitfall", () => {
    for (const competency of COMPETENCIES) {
      expect(competency.indicators.length).toBeGreaterThan(0);
      expect(competency.pitfalls.length).toBeGreaterThan(0);
    }
  });

  it("keeps competency ids unique", () => {
    const ids = COMPETENCIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the entries", () => {
  /*
    The id is what a stored goal holds forever, so its shape is a contract: the competency's own
    slug, a slash, then the entry's slug — and a pitfall's slug says so, because the id is the one
    part of an entry that survives any rewording.
  */
  it("namespaces every entry id by its competency, pitfalls marked as such", () => {
    for (const competency of COMPETENCIES) {
      for (const indicator of competency.indicators) {
        expect(indicator.id).toMatch(new RegExp(`^${competency.id}/[a-z0-9-]+$`));
        expect(indicator.id).not.toContain("/pitfall-");
      }
      for (const pitfall of competency.pitfalls) {
        expect(pitfall.id).toMatch(new RegExp(`^${competency.id}/pitfall-[a-z0-9-]+$`));
      }
    }
  });

  it("keeps entry ids unique across the whole list", () => {
    const ids = competencyEntries().map((entry) => entry.entryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("flattens every indicator and pitfall exactly once, carrying its competency", () => {
    const entries = competencyEntries();
    const expected = COMPETENCIES.reduce(
      (sum, c) => sum + c.indicators.length + c.pitfalls.length,
      0,
    );

    expect(entries).toHaveLength(expected);

    for (const competency of COMPETENCIES) {
      const own = entries.filter((entry) => entry.competencyId === competency.id);
      expect(own).toHaveLength(competency.indicators.length + competency.pitfalls.length);
      for (const entry of own) {
        expect(entry.competencyName).toBe(competency.name);
        expect(entry.group).toBe(competency.group);
      }
    }
  });

  it("resolves every entry by id, with the right kind", () => {
    for (const competency of COMPETENCIES) {
      for (const indicator of competency.indicators) {
        expect(entryById(indicator.id)).toMatchObject({
          entryId: indicator.id,
          kind: "INDICATOR",
          text: indicator.text,
          competencyId: competency.id,
        });
      }
      for (const pitfall of competency.pitfalls) {
        expect(entryById(pitfall.id)).toMatchObject({ entryId: pitfall.id, kind: "PITFALL" });
      }
    }
  });

  it("answers null for an id that names nothing", () => {
    expect(entryById("growth-mindset/no-such-entry")).toBeNull();
    expect(entryById("")).toBeNull();
  });
});

describe("filterCompetencies", () => {
  it("returns the whole list, in order, for an empty or blank query", () => {
    expect(filterCompetencies("")).toEqual(COMPETENCIES);
    expect(filterCompetencies("   ")).toEqual(COMPETENCIES);
  });

  it("matches entry text case-insensitively and drops competencies left with nothing", () => {
    const result = filterCompetencies("PSEUDOCODE");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("mental-models");
    expect(result[0].indicators.map((entry) => entry.id)).toEqual(["mental-models/pseudocode"]);
    expect(result[0].pitfalls).toHaveLength(0);
  });

  /*
    Somebody typing a competency's name is looking for that competency, not for the subset of its
    lines that happen to repeat the name — so a name match keeps everything under it.
  */
  it("keeps every entry of a competency whose name matches", () => {
    const result = filterCompetencies("growth mindset");
    const source = COMPETENCIES.find((competency) => competency.id === "growth-mindset");

    expect(result.map((competency) => competency.id)).toContain("growth-mindset");
    expect(result.find((competency) => competency.id === "growth-mindset")).toEqual(source);
  });

  it("keeps every competency of a group whose label matches", () => {
    const result = filterCompetencies("durable skills");

    expect(result.map((competency) => competency.group)).toEqual(
      Array.from({ length: 8 }, () => "DURABLE_SKILLS"),
    );
    expect(result[0].indicators.length).toBeGreaterThan(0);
  });

  it("answers an empty list when nothing matches", () => {
    expect(filterCompetencies("qqqqzzzz")).toEqual([]);
  });
});
