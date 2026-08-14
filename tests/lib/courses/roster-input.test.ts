import {
  parseRosterInput,
  rosterEntrySchema,
  type ParsedRosterEntry,
} from "@/lib/courses/roster-input";

/**
 * What an instructor's paste is allowed to become.
 *
 * The cases worth writing down are the ones where a wrong answer is silent: a name recorded in the
 * GitHub column produces an entry that matches nobody and reads on the roster as a student who
 * never turned up, and an unlowercased handle produces one the database refuses on the way in.
 */

const entriesOf = (text: string): ParsedRosterEntry[] => parseRosterInput(text).entries;

describe("parseRosterInput", () => {
  it("takes a bare handle", () => {
    expect(entriesOf("ada-lovelace")).toEqual([
      { githubUsername: "ada-lovelace", email: null, note: null },
    ]);
  });

  it("strips the @ people write in front of a handle", () => {
    expect(entriesOf("@ada-lovelace")[0].githubUsername).toBe("ada-lovelace");
  });

  it("lowercases both keys, because that is how they are matched", () => {
    const [entry] = entriesOf("Ada-Lovelace, Ada@Example.COM");
    expect(entry.githubUsername).toBe("ada-lovelace");
    expect(entry.email).toBe("ada@example.com");
  });

  it("takes an address on its own", () => {
    expect(entriesOf("ada@example.com")).toEqual([
      { githubUsername: null, email: "ada@example.com", note: null },
    ]);
  });

  it("reads the three fields in any order", () => {
    const fromOneOrder = entriesOf("ada, ada@example.com, Ada Lovelace")[0];
    const fromAnother = entriesOf("Ada Lovelace, ada@example.com, ada")[0];
    expect(fromOneOrder).toEqual(fromAnother);
    expect(fromOneOrder).toEqual({
      githubUsername: "ada",
      email: "ada@example.com",
      note: "Ada Lovelace",
    });
  });

  it("accepts tabs, which is what a spreadsheet pastes", () => {
    expect(entriesOf("ada\tada@example.com\tAda Lovelace")[0]).toEqual({
      githubUsername: "ada",
      email: "ada@example.com",
      note: "Ada Lovelace",
    });
  });

  /*
    The case the whole parser exists for. A person's name is not a handle and must not be recorded
    as one — an entry keyed on "Ada Lovelace" matches no GitHub account that will ever sign in.
  */
  it("puts a name in the note rather than guessing it is a handle", () => {
    const [entry] = entriesOf("Ada Lovelace, ada@example.com");
    expect(entry.githubUsername).toBeNull();
    expect(entry.note).toBe("Ada Lovelace");
  });

  it("skips blank lines rather than reporting them", () => {
    const parsed = parseRosterInput("ada\n\n\ngrace\n");
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.problems).toHaveLength(0);
  });

  it("reports a line with neither key instead of dropping it", () => {
    const parsed = parseRosterInput("ada\nAda Lovelace Esquire\n");
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.problems).toEqual([
      {
        line: 2,
        text: "Ada Lovelace Esquire",
        reason: "No GitHub username or email address on this line.",
      },
    ]);
  });

  it("reports the same person twice in one paste, pointing at the first", () => {
    const parsed = parseRosterInput("ada\ngrace\nada");
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0].reason).toContain("already on line 1");
  });

  it("catches a repeat that arrives under the other key", () => {
    const parsed = parseRosterInput("ada, ada@example.com\ngrace, ada@example.com");
    expect(parsed.problems[0].reason).toContain("ada@example.com");
  });

  it("does not call two different people duplicates", () => {
    expect(parseRosterInput("ada\ngrace\nalan").problems).toHaveLength(0);
  });
});

describe("rosterEntrySchema", () => {
  it("refuses an entry with neither key", () => {
    const result = rosterEntrySchema.safeParse({
      githubUsername: null,
      email: null,
      note: "Ada",
    });
    expect(result.success).toBe(false);
  });

  it("accepts one with only a handle", () => {
    expect(
      rosterEntrySchema.safeParse({ githubUsername: "ada", email: null, note: null }).success,
    ).toBe(true);
  });

  it("accepts one with only an address", () => {
    expect(
      rosterEntrySchema.safeParse({ githubUsername: null, email: "a@b.co", note: null }).success,
    ).toBe(true);
  });

  /*
    The database carries a CHECK saying the stored value equals its own lowercase, so a schema that
    let mixed case through would turn an instructor's paste into a failed write rather than a
    refusal they can read.
  */
  it("lowercases on the way through, matching the column's constraint", () => {
    const result = rosterEntrySchema.safeParse({
      githubUsername: "Ada",
      email: "Ada@Example.com",
      note: null,
    });
    expect(result.success && result.data.githubUsername).toBe("ada");
    expect(result.success && result.data.email).toBe("ada@example.com");
  });

  it("refuses a handle with characters GitHub does not allow", () => {
    expect(
      rosterEntrySchema.safeParse({ githubUsername: "ada lovelace", email: null, note: null })
        .success,
    ).toBe(false);
  });
});
