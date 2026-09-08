import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  displayNameOf,
  displayNameSchema,
  initials,
  looksLikeFirstLast,
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

/**
 * Whether a name reads as a first name and a last name.
 *
 * The question the join screen asks before it lets a fellow past, and the answers that matter are
 * at both edges: the four shapes the signup trigger actually produces must be refused, or the step
 * never fires for the people it exists for; and every ordinary human name must be accepted, or the
 * warning fires at somebody whose name is simply not the shape a regular expression expected.
 */
describe("looksLikeFirstLast", () => {
  // What the signup trigger leaves behind when a GitHub profile has no full name on it: a handle,
  // a handle with a dot, a handle with digits, or the local part of an email address. Every one of
  // these is a name an instructor would otherwise read on a roster.
  it.each(["bspector", "amina.k", "jrivera23", "ben@marcylabschool.org", "Ada"])(
    "refuses %p, which is a handle rather than a name",
    (name) => {
      expect(looksLikeFirstLast(name)).toBe(false);
    },
  );

  // Accepting these is the more important half. A warning shown to somebody whose name is spelled
  // correctly teaches them that this application is wrong about them.
  it.each([
    "Ada Lovelace",
    "Ben J Spector",
    "Mary Anne O'Brien-Smith",
    "José Ángel Rivera",
    "van Dijk Pieter",
    "de la Cruz Maria",
  ])("accepts %p", (name) => {
    expect(looksLikeFirstLast(name)).toBe(true);
  });

  // The `\s+` split rather than a split on one space, which is the bug `initials` carried in two of
  // its six copies: a doubled space produces an empty part that would otherwise count as a name.
  it("is not fooled by a doubled space into counting an empty part", () => {
    expect(looksLikeFirstLast("Ada  Lovelace")).toBe(true);
    expect(looksLikeFirstLast("Ada  ")).toBe(false);
  });

  // The letter test, which is what stops a count of parts alone from admitting punctuation. Nobody
  // types these on purpose; the point is that the warning fires rather than being skipped.
  it.each(["Ada .", "- -", "  ", ""])(
    "refuses %p, which has only one part with a letter in it",
    (name) => {
      expect(looksLikeFirstLast(name)).toBe(false);
    },
  );

  // Padding is the caller's to worry about nowhere else: the join screen trims before it saves, and
  // this has to agree with it so a pasted name is not judged on its whitespace.
  it("ignores surrounding whitespace", () => {
    expect(looksLikeFirstLast("  Ada Lovelace\n")).toBe(true);
  });
});
