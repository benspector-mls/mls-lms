import {
  firstAttempt,
  sortAttemptRows,
  toggleAttemptsSort,
  understandingTally,
  DEFAULT_ATTEMPTS_SORT,
} from "@/lib/checks/table";
import type { CheckLevel } from "@/lib/generated/prisma/enums";

const at = (day: number) => new Date(Date.UTC(2026, 8, day));
const attempt = (n: number, level: CheckLevel | null, day = n, extra = {}) => ({
  attempt: n,
  submittedAt: at(day),
  wantsHelp: false,
  level,
  instructorLevel: null as CheckLevel | null,
  ...extra,
});

const rows = [
  { name: "Cara", attempts: [attempt(1, "BLOCKED", 1), attempt(2, "RELATIONAL", 9)] },
  { name: "Ada", attempts: [attempt(1, "UNISTRUCTURAL", 3, { wantsHelp: true })] },
  { name: "Bea", attempts: [] },
  { name: "Dev", attempts: [attempt(1, "EXTENDED_ABSTRACT", 2)] },
];
const nameOf = (row: (typeof rows)[number]) => row.name;
const order = (sort: Parameters<typeof sortAttemptRows>[1]) =>
  sortAttemptRows(rows, sort, nameOf).map((row) => row.name);

describe("understandingTally", () => {
  it("counts first attempts and latest attempts separately", () => {
    expect(understandingTally(rows)).toEqual({
      first: { 1: 1, 2: 1, 3: 1 },
      current: { 1: 0, 2: 1, 3: 2 },
      askedForHelp: 1,
      notYetAnswered: 1,
    });
  });

  it("uses an instructor's level where one was set", () => {
    const tally = understandingTally([
      { attempts: [attempt(1, "RELATIONAL", 1, { instructorLevel: "BLOCKED" })] },
    ]);
    expect(tally.first[1]).toBe(1);
    expect(tally.current[1]).toBe(1);
  });
});

describe("firstAttempt", () => {
  it("picks the lowest number, whatever the order", () => {
    expect(firstAttempt([{ attempt: 2 }, { attempt: 1 }])).toEqual({ attempt: 1 });
  });
});

describe("sortAttemptRows", () => {
  it("sorts by name by default", () => {
    expect(order(DEFAULT_ATTEMPTS_SORT)).toEqual(["Ada", "Bea", "Cara", "Dev"]);
  });

  it("sorts levels lowest first, and keeps the unanswered last in both directions", () => {
    expect(order({ by: "first", direction: "asc" })).toEqual(["Cara", "Ada", "Dev", "Bea"]);
    expect(order({ by: "first", direction: "desc" })).toEqual(["Dev", "Ada", "Cara", "Bea"]);
    expect(order({ by: "current", direction: "asc" })).toEqual(["Ada", "Cara", "Dev", "Bea"]);
  });

  it("sorts attempts and submitted times", () => {
    expect(order({ by: "attempts", direction: "desc" })).toEqual(["Cara", "Ada", "Dev", "Bea"]);
    expect(order({ by: "submitted", direction: "desc" })).toEqual(["Cara", "Ada", "Dev", "Bea"]);
  });
});

describe("toggleAttemptsSort", () => {
  it("reverses the same column and opens a new one its own way", () => {
    expect(toggleAttemptsSort({ by: "name", direction: "asc" }, "name")).toEqual({
      by: "name",
      direction: "desc",
    });
    expect(toggleAttemptsSort(DEFAULT_ATTEMPTS_SORT, "submitted")).toEqual({
      by: "submitted",
      direction: "desc",
    });
    expect(toggleAttemptsSort(DEFAULT_ATTEMPTS_SORT, "current")).toEqual({
      by: "current",
      direction: "asc",
    });
  });
});
