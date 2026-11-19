import { isLessonTextSize, LESSON_TEXT_SIZE_SCRIPT } from "@/lib/lessons/text-size";

describe("isLessonTextSize", () => {
  it("accepts the three sizes and refuses names every object has", () => {
    expect(["default", "large", "larger"].every(isLessonTextSize)).toBe(true);
    expect(isLessonTextSize("constructor")).toBe(false);
    expect(isLessonTextSize("huge")).toBe(false);
    expect(isLessonTextSize(null)).toBe(false);
  });
});

describe("LESSON_TEXT_SIZE_SCRIPT", () => {
  it("applies the stored size, and ignores a stored name that is not a size", () => {
    const set = jest.fn();
    const run = (stored: string | null) =>
      new Function("localStorage", "document", LESSON_TEXT_SIZE_SCRIPT)(
        { getItem: () => stored },
        { documentElement: { style: { setProperty: set } } },
      );

    run("larger");
    expect(set).toHaveBeenLastCalledWith("--lesson-text-scale", "1.25");
    set.mockClear();
    run("constructor");
    expect(set).not.toHaveBeenCalled();
  });
});
