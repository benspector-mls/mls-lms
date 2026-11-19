import { keywordsIn, MATCH_END, MATCH_START, snippetParts } from "@/lib/lessons/search";

const mark = (word: string) => `${MATCH_START}${word}${MATCH_END}`;

describe("snippetParts", () => {
  it("splits a snippet into plain runs and matched words, in order", () => {
    expect(snippetParts(`A ${mark("while")} loop ${mark("repeats")} until`)).toEqual([
      { text: "A ", match: false },
      { text: "while", match: true },
      { text: " loop ", match: false },
      { text: "repeats", match: true },
      { text: " until", match: false },
    ]);
  });

  it("keeps a lesson's own angle brackets as text", () => {
    expect(snippetParts(`when a < b, ${mark("loop")}`)).toEqual([
      { text: "when a < b, ", match: false },
      { text: "loop", match: true },
    ]);
  });

  it("drops a marker left without its partner rather than showing it", () => {
    expect(snippetParts(`cut ${MATCH_START}off`)).toEqual([{ text: "cut off", match: false }]);
  });
});

describe("keywordsIn", () => {
  it("keeps the code words English search drops, and nothing else", () => {
    expect(keywordsIn("How to use a FOR loop")).toEqual(["for"]);
    expect(keywordsIn("and or not")).toEqual(["and", "or", "not"]);
    expect(keywordsIn("list comprehension")).toEqual([]);
    expect(keywordsIn("select where on")).toEqual(["where", "on"]);
    expect(keywordsIn("for_each")).toEqual(["for", "each"]);
  });
});
