import {
  companionOf,
  companionsOf,
  isCompanion,
  isSectionType,
  PRIMARY_SECTION_TYPES,
  SECTION_TYPES,
  SECTION_TYPE_REGISTRY,
  sectionTypeEntry,
} from "@/lib/section-types";

/**
 * What the registry has to hold true, now that seven places read it instead of restating it.
 *
 * The compiler already refuses a type in `SECTION_TYPES` with no entry, which is the check that
 * matters most. What it cannot see is whether the *values* collide — two types claiming one
 * rubric, or a heading that is not the one `rubric.md` uses — and those fail at grading time, in
 * a report that looks plausible.
 */

const entries = SECTION_TYPES.map((type) => [type, SECTION_TYPE_REGISTRY[type]] as const);

/*
  A companion is graded by its primary's call, so it shares that call's rubric, heading and
  sample. The uniqueness checks below are about the types that have a call of their own.
*/
const primaries = entries.filter(([type]) => !isCompanion(type));

describe("SECTION_TYPE_REGISTRY", () => {
  it("has an entry for every type, and no others", () => {
    expect(Object.keys(SECTION_TYPE_REGISTRY).sort()).toEqual([...SECTION_TYPES].sort());
  });

  it("fills in every field", () => {
    for (const [type, entry] of entries) {
      for (const field of ["label", "rubricName", "rubricHeading", "sampleFile"] as const) {
        expect(`${type}.${field}=${entry[field]}`).toMatch(/=.+$/);
      }
    }
  });

  // A rubric graded against two types is the failure this pairing exists to prevent: a coding
  // section scored against short-response criteria still produces a confident report.
  it("gives each primary type its own rubric", () => {
    const names = primaries.map(([, entry]) => entry.rubricName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives each primary type its own heading", () => {
    const headings = primaries.map(([, entry]) => entry.rubricHeading);
    expect(new Set(headings).size).toBe(headings.length);
  });

  // The same call grades both, so a companion scored against a different rubric than its primary
  // would describe criteria the model was never shown.
  it("gives a companion its primary's rubric, heading and sample", () => {
    for (const type of SECTION_TYPES) {
      const primary = companionOf(type);
      if (primary === null) continue;
      const entry = sectionTypeEntry(type);
      expect(entry.rubricName).toBe(SECTION_TYPE_REGISTRY[primary].rubricName);
      expect(entry.rubricHeading).toBe(SECTION_TYPE_REGISTRY[primary].rubricHeading);
      expect(entry.sampleFile).toBe(SECTION_TYPE_REGISTRY[primary].sampleFile);
      expect(entry.defaultPointValue).toBeGreaterThan(0);
    }
  });

  // Rubric names are looked up against the `Rubric` table by exact string, so a lowercase one or
  // one with a space would find nothing and every section of that type would refuse to save.
  it("names rubrics the way the seeded rows are named", () => {
    for (const [, entry] of entries) {
      expect(entry.rubricName).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });

  // Sliced out of rubric.md by exact heading text, so a trailing space is a run that throws.
  it("uses headings that are trimmed and upper case", () => {
    for (const [, entry] of entries) {
      expect(entry.rubricHeading).toBe(entry.rubricHeading.trim());
      expect(entry.rubricHeading).toBe(entry.rubricHeading.toUpperCase());
    }
  });

  // Read as `grading-toolkit/${sampleFile}`, so anything with a slash in it escapes the folder.
  it("names sample files, not paths", () => {
    for (const [, entry] of entries) {
      expect(entry.sampleFile).toMatch(/^[\w.-]+\.md$/);
    }
  });

  // Deliberately NOT one-per-type: the toolkit holds no SQL sample, so coding_sql borrows the
  // frontend report. This records that as a known state rather than leaving a future reader to
  // wonder whether it is a copy-and-paste slip — see the comment on the entry.
  it("shares the frontend sample with coding_sql, and no other primary doubles up", () => {
    const files = primaries.map(([, entry]) => entry.sampleFile);
    expect(
      files.filter((file) => file === SECTION_TYPE_REGISTRY.coding_frontend.sampleFile),
    ).toEqual([
      SECTION_TYPE_REGISTRY.coding_sql.sampleFile,
      SECTION_TYPE_REGISTRY.coding_frontend.sampleFile,
    ]);
    expect(new Set(files).size).toBe(primaries.length - 1);
  });
});

describe("companions", () => {
  it("names the writing section as the short response's one companion", () => {
    expect(companionsOf("short_response")).toEqual(["short_response_writing"]);
    expect(companionOf("short_response_writing")).toBe("short_response");
    expect(isCompanion("short_response_writing")).toBe(true);
  });

  it("gives every other type no companions", () => {
    for (const type of SECTION_TYPES) {
      if (type === "short_response") continue;
      expect(companionsOf(type)).toEqual([]);
    }
    for (const type of SECTION_TYPES) {
      if (type === "short_response_writing") continue;
      expect(companionOf(type)).toBeNull();
      expect(isCompanion(type)).toBe(false);
    }
  });

  // The select in the section editor lists these; a companion offered there could be declared
  // with nothing to fill it.
  it("lists only the types with a call of their own as primaries, in order", () => {
    expect(PRIMARY_SECTION_TYPES).toEqual([
      "short_response",
      "coding_algorithm",
      "coding_sql",
      "coding_frontend",
    ]);
  });
});

describe("isSectionType", () => {
  it("admits every declared type", () => {
    for (const type of SECTION_TYPES) expect(isSectionType(type)).toBe(true);
  });

  // The `sections` column is JSON, so a stored type is a string until this narrows it. A type
  // written by a later version of the application has to read as "not one of ours" rather than
  // throw, or an older deployment could not open the assignment at all.
  it("refuses anything else without throwing", () => {
    for (const value of ["", "coding", "SHORT_RESPONSE", "short-response", "coding_backend"]) {
      expect(isSectionType(value)).toBe(false);
    }
  });
});
