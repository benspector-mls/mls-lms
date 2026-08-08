import { isSectionType, SECTION_TYPES, SECTION_TYPE_REGISTRY } from "@/lib/section-types";

/**
 * What the registry has to hold true, now that seven places read it instead of restating it.
 *
 * The compiler already refuses a type in `SECTION_TYPES` with no entry, which is the check that
 * matters most. What it cannot see is whether the *values* collide — two types claiming one
 * rubric, or a heading that is not the one `rubric.md` uses — and those fail at grading time, in
 * a report that looks plausible.
 */

const entries = SECTION_TYPES.map((type) => [type, SECTION_TYPE_REGISTRY[type]] as const);

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
  it("gives each type its own rubric", () => {
    const names = entries.map(([, entry]) => entry.rubricName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives each type its own heading", () => {
    const headings = entries.map(([, entry]) => entry.rubricHeading);
    expect(new Set(headings).size).toBe(headings.length);
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
  it("shares the frontend sample with coding_sql, and nothing else doubles up", () => {
    const files = entries.map(([, entry]) => entry.sampleFile);
    expect(
      files.filter((file) => file === SECTION_TYPE_REGISTRY.coding_frontend.sampleFile),
    ).toEqual([
      SECTION_TYPE_REGISTRY.coding_sql.sampleFile,
      SECTION_TYPE_REGISTRY.coding_frontend.sampleFile,
    ]);
    expect(new Set(files).size).toBe(SECTION_TYPES.length - 1);
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
