import { composeReport, readReportRows, rowTotals, type ReportRow } from "@/lib/grade/report-text";

/**
 * The comment a student reads, built from the rows an instructor edits.
 *
 * The score an instructor types on a row is the only number they change, so every other number in
 * the posted comment — the title's total and percentage, a checklist section's subtotal — has to
 * come from the rows here, and has to come out the same in the browser's preview and on the server.
 */

function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    label: "Question 1: calculate_area",
    group: null,
    criterion: "algorithm",
    scoreEarned: 3,
    scorePossible: 3,
    feedbackMarkdown: "",
    modelReasoning: null,
    ...overrides,
  };
}

describe("composeReport", () => {
  it("writes the title with the total, the summary, a rule, and one heading per row", () => {
    expect(
      composeReport({
        sectionType: "coding_algorithm",
        summaryMarkdown: "Good start on this.",
        rows: [
          row(),
          row({
            label: "Question 2: is_even",
            scoreEarned: 1,
            feedbackMarkdown: "- The condition checks divisibility by 4.",
          }),
        ],
      }),
    ).toBe(
      [
        "# Coding Fluency Score Report: 4/6 = 67%",
        "Good start on this.",
        "---",
        "## Question 1: calculate_area: 3/3",
        "## Question 2: is_even: 1/3\n\n- The condition checks divisibility by 4.",
      ].join("\n\n"),
    );
  });

  it("gives a short response report its total like every other report", () => {
    expect(
      composeReport({
        sectionType: "short_response",
        summaryMarkdown: "Nice work.",
        rows: [row({ label: "Question 1: Scope", criterion: "technical" })],
      }).split("\n")[0],
    ).toBe("# Short Response Score Report: 3/3 = 100%");
  });

  it("follows an edited row score into the title", () => {
    const rows = [row({ scoreEarned: 2 }), row({ label: "Question 2: is_even" })];
    const before = composeReport({ sectionType: "coding_algorithm", summaryMarkdown: "", rows });
    const after = composeReport({
      sectionType: "coding_algorithm",
      summaryMarkdown: "",
      rows: [{ ...rows[0], scoreEarned: 3 }, rows[1]],
    });
    expect(before.split("\n")[0]).toBe("# Coding Fluency Score Report: 5/6 = 83%");
    expect(after.split("\n")[0]).toBe("# Coding Fluency Score Report: 6/6 = 100%");
    expect(after).toContain("## Question 1: calculate_area: 3/3");
  });

  it("lists checklist rows as boxes under their group, with the group's subtotal", () => {
    expect(
      composeReport({
        sectionType: "coding_frontend",
        summaryMarkdown: "Nice work.",
        rows: [
          row({
            label: "`getAll()` returns a copy",
            group: "Section 2: Class",
            scorePossible: 1,
            scoreEarned: 1,
          }),
          row({
            label: "`searchRecipes()` returns `{ data, error }`",
            group: "Section 3: Fetch",
            scorePossible: 1,
            scoreEarned: 0.5,
            feedbackMarkdown: "- Half Credit: the catch block returns the Error object.",
          }),
          row({
            label: "`getAllRecipes()` checks `response.ok`",
            group: "Section 3: Fetch",
            scorePossible: 1,
            scoreEarned: 1,
          }),
        ],
      }),
    ).toBe(
      [
        "# Frontend Coding Report: 2.5/3 = 83%",
        "Nice work.",
        "---",
        "## Section 2: Class: 1/1\n\n- [x] `getAll()` returns a copy",
        "## Section 3: Fetch: 1.5/2\n\n" +
          "- [ ] `searchRecipes()` returns `{ data, error }`\n" +
          "  - Half Credit: the catch block returns the Error object.\n" +
          "- [x] `getAllRecipes()` checks `response.ok`",
      ].join("\n\n"),
    );
  });

  it("adds half points without floating-point noise", () => {
    const rows = [0.1, 0.2, 0.2].map((scoreEarned) => row({ scoreEarned, scorePossible: 1 }));
    expect(rowTotals(rows)).toEqual({ earned: 0.5, possible: 3 });
  });

  it("marks an emptied score box rather than counting it as zero", () => {
    const rows = [row(), row({ scoreEarned: null })];
    expect(rowTotals(rows).earned).toBeNull();
    expect(
      composeReport({ sectionType: "coding_algorithm", summaryMarkdown: "", rows }).split("\n")[0],
    ).toBe("# Coding Fluency Score Report: ?/6");
  });
});

describe("readReportRows", () => {
  it("reads a row stored before rows carried feedback, taking its note as the reasoning", () => {
    expect(
      readReportRows([
        {
          label: "Q1",
          criterion: "algorithm",
          scoreEarned: 2,
          scorePossible: 3,
          note: "off by one",
        },
      ]),
    ).toEqual([
      {
        label: "Q1",
        group: null,
        criterion: "algorithm",
        scoreEarned: 2,
        scorePossible: 3,
        feedbackMarkdown: "",
        modelReasoning: "off by one",
      },
    ]);
  });
});
