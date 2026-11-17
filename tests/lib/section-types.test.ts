import { isSectionType, SECTION_TYPES, SECTION_TYPE_REGISTRY } from "@/lib/section-types";

/**
 * What the registry has to hold true, now that the places that name a section type read it
 * instead of restating it.
 *
 * The compiler already refuses a type in `SECTION_TYPES` with no entry, which is the check that
 * matters most. What it cannot see is an entry whose fields are empty strings.
 */

const entries = SECTION_TYPES.map((type) => [type, SECTION_TYPE_REGISTRY[type]] as const);

describe("SECTION_TYPE_REGISTRY", () => {
  it("has an entry for every type, and no others", () => {
    expect(Object.keys(SECTION_TYPE_REGISTRY).sort()).toEqual([...SECTION_TYPES].sort());
  });

  it("fills in every field", () => {
    for (const [type, entry] of entries) {
      for (const field of ["label", "reportTitle"] as const) {
        expect(`${type}.${field}=${entry[field]}`).toMatch(/=.+$/);
      }
    }
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
