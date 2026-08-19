import { csvLine, csvText, parseCsv, parseCsvRecords } from "@/lib/csv";

describe("parseCsv", () => {
  it("reads plain fields and rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("reads either line ending, which is what the two exports and Excel between them produce", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not turn a trailing newline into an empty row", () => {
    expect(parseCsv("a,b\n1,2\n")).toHaveLength(2);
  });

  it("keeps an empty field rather than dropping it", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
    expect(parseCsv("a,b,")).toEqual([["a", "b", ""]]);
    expect(parseCsv(",b,c")).toEqual([["", "b", "c"]]);
  });

  it("unwraps a quoted field", () => {
    expect(parseCsv('"a","b"')).toEqual([["a", "b"]]);
  });

  /*
    The three characters the writer quotes *for*. A comma would split the field, a newline would
    split the row, and a quote would end it early — so these are the cases where a parser that
    only split on commas gives a plausible, wrong answer rather than an error.
  */
  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('"Lovelace, Ada",1')).toEqual([["Lovelace, Ada", "1"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('"line one\nline two",1')).toEqual([["line one\nline two", "1"]]);
  });

  it("reads a doubled quote as one literal quote", () => {
    expect(parseCsv('"she said ""hi""",1')).toEqual([['she said "hi"', "1"]]);
  });

  it("skips a blank line rather than reading a row of one empty field", () => {
    expect(parseCsv("a,b\n\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("has nothing to read in an empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

/**
 * The property that makes both halves of this file trustworthy.
 *
 * Each is checkable on its own only against a hand-written expectation, which is the same author
 * guessing twice. Together they are checkable against each other: whatever `csvLine` writes,
 * `parseCsv` has to give back.
 */
describe("the writer and the reader agree", () => {
  it.each([
    ["plain", ["a", "b", "c"]],
    ["a comma", ["Lovelace, Ada", "x"]],
    ["a quote", ['she said "hi"', "x"]],
    ["a newline", ["line one\nline two", "x"]],
    ["all three at once", ['a, "b"\nc', "x"]],
    ["empty fields", ["", "b", ""]],
    ["leading and trailing spaces", ["  padded  ", "x"]],
  ])("round-trips %s", (_label, fields) => {
    expect(parseCsv(csvLine(fields))).toEqual([fields]);
  });

  /*
    The one deliberate exception, and it is not a round trip. `csvText` prefixes a value that a
    spreadsheet would evaluate as a formula with an apostrophe, which is a real change to the
    text — so reading it back gives the apostrophe too. The parser must not strip it: a file it
    reads was written by somebody else, and guessing the apostrophe was ours would corrupt a
    value that genuinely begins with one.
  */
  it("does not undo the formula guard, because a foreign file may mean it", () => {
    expect(csvText('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(parseCsv(csvLine(["=SUM(A1)"]))).toEqual([["'=SUM(A1)"]]);
  });
});

describe("parseCsvRecords", () => {
  it("keys each row by the header rather than by position", () => {
    const records = parseCsvRecords("Name,Score\nAda,512\nGrace,478");
    expect(records).toEqual([
      { Name: "Ada", Score: "512" },
      { Name: "Grace", Score: "478" },
    ]);
  });

  /*
    Position is exactly what must not be relied on. CodeSignal's export has thirty columns and no
    promise about their order, and a reader that counted would break silently the day one is
    inserted — column 17 of 30 still parses as a number, just the wrong one.
  */
  it("finds a column wherever it has moved to", () => {
    const first = parseCsvRecords("Score,Name\n512,Ada")[0]!;
    const second = parseCsvRecords("Name,Score\nAda,512")[0]!;
    expect(first.Score).toBe(second.Score);
  });

  it("gives an empty string for a column a short row does not reach", () => {
    expect(parseCsvRecords("a,b,c\n1,2")[0]).toEqual({ a: "1", b: "2", c: "" });
  });

  // Excel writes one, and without stripping it the first column's name would carry an invisible
  // character and every lookup against it would miss.
  it("strips the byte-order mark Excel writes", () => {
    expect(parseCsvRecords("﻿Name,Score\nAda,512")[0]).toEqual({ Name: "Ada", Score: "512" });
  });

  it("has no records when there is only a header, or nothing at all", () => {
    expect(parseCsvRecords("Name,Score")).toEqual([]);
    expect(parseCsvRecords("")).toEqual([]);
  });
});
