import { displayNameOf, initials } from "@/lib/people";

/**
 * The two questions every screen asks about a person.
 *
 * Worth testing precisely because both looked too small to be worth it: `initials` existed in six
 * copies and four behaviours, and the copies differed only on the inputs nobody types on purpose.
 * Those inputs are most of what is below.
 */

describe("displayNameOf", () => {
  const nobody = { displayName: null, email: null, githubUsername: null };

  it("prefers a display name", () => {
    expect(
      displayNameOf(
        { ...nobody, displayName: "Ada Lovelace", githubUsername: "ada", email: "ada@example.com" },
        "someone",
      ),
    ).toBe("Ada Lovelace");
  });

  it("falls through to the GitHub login before the email", () => {
    expect(
      displayNameOf({ ...nobody, githubUsername: "ada", email: "ada@example.com" }, "someone"),
    ).toBe("ada");
  });

  it("uses the email when that is all there is", () => {
    expect(displayNameOf({ ...nobody, email: "ada@example.com" }, "someone")).toBe(
      "ada@example.com",
    );
  });

  it("takes the caller's fallback rather than one of its own", () => {
    // The reason `fallback` is required: this sentence is about an instructor, and the same
    // function is called a line away about a student.
    expect(displayNameOf(nobody, "its owner")).toBe("its owner");
    expect(displayNameOf(nobody, "that student")).toBe("that student");
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
  });

  it("stops at two, however many names there are", () => {
    expect(initials("Mary Jane Watson Parker")).toBe("MJ");
  });

  it("uppercases", () => {
    expect(initials("ada lovelace")).toBe("AL");
  });

  it("one name gives one letter", () => {
    expect(initials("Ada")).toBe("A");
  });

  // The case two of the six copies got wrong: splitting on a single space makes the gap its own
  // piece, and the gap took the second slot.
  it("is not fooled by a double space", () => {
    expect(initials("Ada  Lovelace")).toBe("AL");
  });

  it("is not fooled by leading or trailing space", () => {
    expect(initials("  Ada Lovelace ")).toBe("AL");
  });

  it("handles the other whitespace a pasted name carries", () => {
    expect(initials("Ada\tLovelace")).toBe("AL");
    expect(initials("Ada\nLovelace")).toBe("AL");
  });

  // The case the other three got wrong: an empty result draws as a blank circle, which reads as
  // a loading state that never finishes rather than as a missing name.
  it("answers ? when there is no name", () => {
    expect(initials(null)).toBe("?");
    expect(initials(undefined)).toBe("?");
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });

  // What `displayNameOf` hands it when somebody has set nothing else, so it is a real input
  // rather than a degenerate one.
  it("gives one letter for an email address", () => {
    expect(initials("ben@marcylabschool.org")).toBe("B");
  });
});
