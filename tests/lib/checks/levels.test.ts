import { CHECK_LEVELS, effectiveLevel, levelCategory } from "@/lib/checks/levels";

describe("levelCategory", () => {
  it("folds five levels into the three a fellow reads", () => {
    expect(CHECK_LEVELS.map(levelCategory)).toEqual([1, 2, 2, 3, 3]);
  });
});

describe("effectiveLevel", () => {
  it("prefers an instructor's level over the review's", () => {
    expect(effectiveLevel({ level: "UNISTRUCTURAL", instructorLevel: "RELATIONAL" })).toBe(
      "RELATIONAL",
    );
  });

  it("falls back to the review's, and is null when neither exists", () => {
    expect(effectiveLevel({ level: "BLOCKED", instructorLevel: null })).toBe("BLOCKED");
    expect(effectiveLevel({ level: null, instructorLevel: null })).toBeNull();
  });
});
