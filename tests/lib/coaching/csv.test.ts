import { ALL_PROMPTS, PREPARATION_PROMPT, type CoachingSnapshot } from "@/lib/coaching";
import {
  coachingCsv,
  coachingCsvFilename,
  type CoachingCsvData,
  type CoachingCsvSession,
} from "@/lib/coaching/csv";
import { parseCsv } from "@/lib/csv";

/**
 * One fellow's coaching history as a file. What matters here is that every row has the same
 * columns — answers matched to prompts by id, course figures matched to courses by id — and that
 * a draft leaves the snapshot empty rather than claiming zeros.
 */

function snapshot(courses: CoachingSnapshot["courses"] = []): CoachingSnapshot {
  return {
    version: 1,
    takenAt: "2026-10-01T18:00:00.000Z",
    attendance: {
      eligible: 20,
      present: 15,
      late: 2,
      excused: 1,
      absent: 1,
      unrecorded: 1,
      rate: 0.85,
    },
    courses,
  };
}

function course(id: string, name: string): CoachingSnapshot["courses"][number] {
  return {
    courseId: id,
    name,
    completedAssignments: { complete: 7, possible: 10 },
    missing: 1,
    late: 2,
    verdict: "pending",
  };
}

function session(overrides: Partial<CoachingCsvSession> = {}): CoachingCsvSession {
  return {
    heldOn: "2026-10-01",
    createdAt: new Date("2026-10-01T14:00:00Z"),
    // 18:30 UTC in October is 14:30 in New York.
    endedAt: new Date("2026-10-01T18:30:00Z"),
    author: { displayName: "Coach Carter", email: null, githubUsername: null },
    temperature: 7,
    answers: [],
    snapshot: snapshot([course("c1", "Mod 1")]),
    ...overrides,
  };
}

function data(sessions: CoachingCsvSession[] = [session()]): CoachingCsvData {
  return {
    person: {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      githubUsername: "ada",
      testStudentNumber: null,
    },
    program: { name: "Software Engineering" },
    sessions,
  };
}

/** The file read back as records keyed by header, through the parser that is checked against `csvLine`. */
function records(csv: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(csv);
  return rows.map((row) => Object.fromEntries(header!.map((name, i) => [name, row[i] ?? ""])));
}

function header(csv: string): string[] {
  return parseCsv(csv)[0]!;
}

describe("coachingCsv", () => {
  it("heads one column per prompt, in the template's order and current wording", () => {
    const columns = header(coachingCsv(data()));
    const first = columns.indexOf(ALL_PROMPTS[0].prompt);

    expect(first).toBeGreaterThan(-1);
    expect(columns.slice(first, first + ALL_PROMPTS.length)).toEqual(
      ALL_PROMPTS.map((prompt) => prompt.prompt),
    );
  });

  it("writes one row per session, oldest first", () => {
    const rows = records(
      coachingCsv(
        data([
          session({ heldOn: "2026-10-08", temperature: 9 }),
          session({ heldOn: "2026-09-24", temperature: 4 }),
        ]),
      ),
    );

    expect(rows.map((row) => row["Held on"])).toEqual(["2026-09-24", "2026-10-08"]);
    expect(rows.map((row) => row["Temperature"])).toEqual(["4", "9"]);
  });

  it("puts each answer under its own prompt, whatever order the answers were stored in", () => {
    const [row] = records(
      coachingCsv(
        data([
          session({
            answers: [
              { promptId: "support", prompt: "An older wording", answer: "Pairing" },
              {
                promptId: PREPARATION_PROMPT.id,
                prompt: PREPARATION_PROMPT.prompt,
                answer: "Ask about Mod 2",
              },
            ],
          }),
        ]),
      ),
    );

    expect(row![PREPARATION_PROMPT.prompt]).toBe("Ask about Mod 2");
    expect(row!["What kind of support or accountability would feel helpful?"]).toBe("Pairing");
    // A prompt nobody answered is an empty cell, not a missing one.
    expect(row!["What has been on your mind lately?"]).toBe("");
  });

  it("marks a draft as in progress and leaves its snapshot empty rather than zero", () => {
    const [row] = records(coachingCsv(data([session({ endedAt: null, snapshot: null })])));

    expect(row!["Status"]).toBe("In progress");
    expect(row!["Completed at"]).toBe("");
    expect(row!["Mornings eligible"]).toBe("");
    expect(row!["Attendance rate (%)"]).toBe("");
  });

  it("carries a completed session's attendance figures, and the rate as a whole percent", () => {
    const [row] = records(coachingCsv(data()));

    expect(row!["Status"]).toBe("Completed");
    expect(row!["Completed at"]).toBe("2026-10-01 14:30");
    expect(row!["Mornings eligible"]).toBe("20");
    expect(row!["Present"]).toBe("15");
    expect(row!["Unrecorded"]).toBe("1");
    expect(row!["Attendance rate (%)"]).toBe("85");
  });

  it("gives every course any snapshot froze its own columns, empty where a session lacks it", () => {
    const rows = records(
      coachingCsv(
        data([
          session({ heldOn: "2026-09-24", snapshot: snapshot([course("c1", "Mod 1")]) }),
          session({
            heldOn: "2026-10-08",
            snapshot: snapshot([course("c1", "Mod 1"), course("c2", "Mod 2")]),
          }),
        ]),
      ),
    );

    expect(rows[0]!["Mod 1 · assignments complete"]).toBe("7");
    expect(rows[0]!["Mod 2 · assignments complete"]).toBe("");
    expect(rows[1]!["Mod 2 · missing"]).toBe("1");
    expect(rows[1]!["Mod 2 · verdict"]).toBe("Not finished");
  });

  it("keeps a renamed course in one group of columns, under its newest name", () => {
    const csv = coachingCsv(
      data([
        session({ heldOn: "2026-09-24", snapshot: snapshot([course("c1", "Module 1")]) }),
        session({ heldOn: "2026-10-08", snapshot: snapshot([course("c1", "Mod 1: Foundations")]) }),
      ]),
    );

    const columns = header(csv);
    expect(columns).toContain("Mod 1: Foundations · late");
    expect(columns.some((column) => column.startsWith("Module 1"))).toBe(false);
    expect(records(csv).map((row) => row["Mod 1: Foundations · late"])).toEqual(["2", "2"]);
  });

  it("leaves the snapshot empty when it is a shape it cannot read, rather than throwing", () => {
    const [row] = records(coachingCsv(data([session({ snapshot: { version: 2 } })])));

    expect(row!["Status"]).toBe("Completed");
    expect(row!["Present"]).toBe("");
  });

  it("names a session whose instructor's account has gone the way the record does", () => {
    const [row] = records(coachingCsv(data([session({ author: null })])));
    expect(row!["Led by"]).toBe("A former instructor");
  });

  it("neutralises an answer a spreadsheet would otherwise execute", () => {
    const csv = coachingCsv(
      data([
        session({
          answers: [
            { promptId: "excited", prompt: "x", answer: '=HYPERLINK("http://evil.example")' },
          ],
        }),
      ]),
    );

    expect(records(csv)[0]!["What are you most excited to work on at the moment?"]).toBe(
      `'=HYPERLINK("http://evil.example")`,
    );
  });

  it("marks a test student in the name, as the screens do", () => {
    const csv = coachingCsv({
      ...data(),
      person: { ...data().person, testStudentNumber: 1 },
    });
    expect(records(csv)[0]!["Fellow"]).toBe("Ada Lovelace (test student)");
  });
});

describe("coachingCsvFilename", () => {
  it("names the fellow, the term, and the day it was taken", () => {
    expect(
      coachingCsvFilename({
        fellow: "Ada Lovelace",
        term: "Fall 2026",
        date: new Date(2026, 9, 15),
      }),
    ).toBe("coaching-ada-lovelace-fall-2026-2026-10-15.csv");
  });
});
