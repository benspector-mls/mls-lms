import { closestAnswerKeyDir } from "@/lib/grade/assets";

/**
 * Which answer key folder a template's name points at.
 *
 * The folder names are real ones from the grading guides repository, including the pairs that
 * share a `swe-N-M` part, because those pairs are where a looser rule would fill in the wrong
 * folder without anybody noticing until a report came back graded against another assignment.
 */

const MOD_6 = [
  "answer-keys/mod-6-databases/swe-6-1-sql-basics",
  "answer-keys/mod-6-databases/swe-6-1-sql-basics-sr",
  "answer-keys/mod-6-databases/swe-6-2-creating-tables-and-aggregates",
  "answer-keys/mod-6-databases/swe-checkpoint-6-databases",
];

const MOD_7 = ["answer-keys/mod-7-react/swe-7-1", "answer-keys/mod-7-react/swe-7-1-sr"];

describe("closestAnswerKeyDir", () => {
  it("finds the folder whose name is the template's name", () => {
    expect(closestAnswerKeyDir("swe-6-1-sql-basics", MOD_6)).toBe(
      "answer-keys/mod-6-databases/swe-6-1-sql-basics",
    );
    expect(closestAnswerKeyDir("swe-6-1-sql-basics-sr", MOD_6)).toBe(
      "answer-keys/mod-6-databases/swe-6-1-sql-basics-sr",
    );
  });

  it("matches on the swe-N-M part when the rest of the name differs", () => {
    expect(closestAnswerKeyDir("swe-6-2-tables", MOD_6)).toBe(
      "answer-keys/mod-6-databases/swe-6-2-creating-tables-and-aggregates",
    );
  });

  it("prefers the base folder over a variant the template does not name", () => {
    expect(closestAnswerKeyDir("swe-7-1-react-intro", MOD_7)).toBe(
      "answer-keys/mod-7-react/swe-7-1",
    );
    expect(closestAnswerKeyDir("swe-7-1-sr", MOD_7)).toBe("answer-keys/mod-7-react/swe-7-1-sr");
  });

  it("does not match a different assignment whose number begins the same way", () => {
    expect(closestAnswerKeyDir("swe-1-1-ops", ["answer-keys/mod-1-js/swe-1-10-extra"])).toBeNull();
  });

  it("finds nothing for a template without a swe-N-M part", () => {
    expect(closestAnswerKeyDir("swe-checkpoint-6-databases", MOD_6)).toBeNull();
    expect(closestAnswerKeyDir("my-starter", MOD_6)).toBeNull();
  });

  it("finds nothing when no folder shares the number", () => {
    expect(closestAnswerKeyDir("swe-6-4-join-queries", MOD_6)).toBeNull();
  });

  it("finds a Python key by its full name", () => {
    expect(
      closestAnswerKeyDir("swe-1-4-loops-python", [
        "answer-keys-py/mod-1/swe-1-4-loops-python",
        "answer-keys-py/mod-1/swe-sr-1-4-loops-python",
      ]),
    ).toBe("answer-keys-py/mod-1/swe-1-4-loops-python");
  });
});
