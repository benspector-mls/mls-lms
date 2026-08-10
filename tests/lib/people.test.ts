import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  displayNameOf,
  displayNameSchema,
  initials,
} from "@/lib/people";

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

/**
 * The rule the Profile form and the `updateDisplayName` procedure share.
 *
 * Worth testing for the reason it is shared at all: the form decides what to disable the Save
 * button on and the procedure decides what to refuse, and the failure they can produce between them
 * is a name that types cleanly and will not save.
 */
describe("displayNameSchema", () => {
  const parse = (input: string) => displayNameSchema.safeParse(input);

  it("takes an ordinary name", () => {
    expect(parse("Ada Lovelace")).toMatchObject({ success: true, data: "Ada Lovelace" });
  });

  // The whole point of `.trim()` running before the length checks rather than after.
  it("trims before measuring, so the stored name carries no padding", () => {
    expect(parse("  Ada Lovelace  ")).toMatchObject({ success: true, data: "Ada Lovelace" });
  });

  it("refuses a name that is only whitespace", () => {
    // Four characters long before the trim, and zero after it.
    expect(parse("    ").success).toBe(false);
  });

  it("refuses one below the floor", () => {
    expect(parse("A").success).toBe(false);
    expect(parse("").success).toBe(false);
  });

  it("accepts exactly the floor", () => {
    expect(parse("Jo").success).toBe(true);
  });

  it("accepts exactly the ceiling and refuses one past it", () => {
    expect(parse("a".repeat(DISPLAY_NAME_MAX_LENGTH)).success).toBe(true);
    expect(parse("a".repeat(DISPLAY_NAME_MAX_LENGTH + 1)).success).toBe(false);
  });

  // A pasted name arrives with the newline attached, and a trailing one must not be what puts a
  // name of exactly the maximum length over the limit.
  it("is not pushed over the ceiling by a trailing newline", () => {
    expect(parse(`${"a".repeat(DISPLAY_NAME_MAX_LENGTH)}\n`).success).toBe(true);
  });

  // The messages are read by whoever typed the name, under the field, so they are part of the
  // behaviour rather than incidental to it.
  it("says what is wrong in the words the form shows", () => {
    expect(parse("A").error?.issues[0]?.message).toBe(
      `Please use at least ${DISPLAY_NAME_MIN_LENGTH} characters.`,
    );
    expect(parse("a".repeat(DISPLAY_NAME_MAX_LENGTH + 1)).error?.issues[0]?.message).toBe(
      `Please use ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`,
    );
  });
});
