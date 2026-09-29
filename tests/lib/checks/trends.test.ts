import { recentChecks, recentChecksSentence, type TrendAttempt } from "@/lib/checks/trends";

/**
 * The check reading in a fellow's Trends. What matters is the two distinctions it exists to draw:
 * answered or not, and blocked-and-asked from blocked-and-did-not-ask.
 */

const day = (n: number) => new Date(Date.UTC(2026, 8, n));
const attempt = (overrides: Partial<TrendAttempt> = {}): TrendAttempt => ({
  attempt: 1,
  level: "MULTISTRUCTURAL",
  instructorLevel: null,
  wantsHelp: false,
  ...overrides,
});

describe("recentChecks", () => {
  it("reads only the newest five checks, answered or not", () => {
    const checks = [
      // The oldest, outside the window: a blocked answer here must not count.
      { createdAt: day(1), attempts: [attempt({ level: "BLOCKED" })] },
      { createdAt: day(2), attempts: [attempt()] },
      { createdAt: day(3), attempts: [] },
      { createdAt: day(4), attempts: [attempt({ level: "BLOCKED", wantsHelp: true })] },
      { createdAt: day(5), attempts: [attempt({ level: "BLOCKED" })] },
      { createdAt: day(6), attempts: [attempt({ wantsHelp: true })] },
    ];

    expect(recentChecks(checks)).toEqual({
      checks: 5,
      answered: 4,
      blocked: 2,
      blockedAskedHelp: 1,
      otherAskedHelp: 1,
    });
  });

  it("reads the latest attempt, with an instructor's level over the review's", () => {
    const checks = [
      {
        createdAt: day(1),
        attempts: [
          attempt({ attempt: 2, level: "RELATIONAL" }),
          attempt({ attempt: 1, level: "BLOCKED", wantsHelp: true }),
        ],
      },
      {
        createdAt: day(2),
        attempts: [attempt({ level: "RELATIONAL", instructorLevel: "BLOCKED" })],
      },
    ];

    // The first moved past Blocked, though it asked for help on the way; the second an instructor
    // set to Blocked.
    expect(recentChecks(checks)).toMatchObject({
      blocked: 1,
      blockedAskedHelp: 0,
      otherAskedHelp: 1,
    });
  });
});

describe("recentChecksSentence", () => {
  const reading = (overrides: Partial<ReturnType<typeof recentChecks>>) => ({
    checks: 5,
    answered: 5,
    blocked: 0,
    blockedAskedHelp: 0,
    otherAskedHelp: 0,
    ...overrides,
  });

  it("says nothing for a course with no checks", () => {
    expect(recentChecksSentence(reading({ checks: 0, answered: 0 }))).toBeNull();
  });

  it("names the window, and says 'so far' when there are fewer checks than it holds", () => {
    expect(recentChecksSentence(reading({}))).toBe("answered all of the last 5 checks");
    expect(recentChecksSentence(reading({ checks: 3, answered: 2 }))).toBe(
      "answered 2 of the 3 checks so far",
    );
    expect(recentChecksSentence(reading({ checks: 1, answered: 0 }))).toBe(
      "answered none of the 1 check so far",
    );
  });

  it("tells blocked-and-asked from blocked-and-did-not-ask", () => {
    expect(recentChecksSentence(reading({ answered: 4, blocked: 2, blockedAskedHelp: 1 }))).toBe(
      "answered 4 of the last 5 checks; blocked on 2 of them, and asked for help on 1 of those",
    );
    expect(recentChecksSentence(reading({ blocked: 1 }))).toBe(
      "answered all of the last 5 checks; blocked on 1 of them, and did not ask for help on it",
    );
    expect(recentChecksSentence(reading({ blocked: 2, blockedAskedHelp: 2 }))).toBe(
      "answered all of the last 5 checks; blocked on 2 of them, and asked for help on all of those",
    );
  });

  it("mentions help asked for on checks that were not blocked", () => {
    expect(recentChecksSentence(reading({ otherAskedHelp: 1 }))).toBe(
      "answered all of the last 5 checks; asked for help on 1 of them",
    );
    expect(recentChecksSentence(reading({ blocked: 1, otherAskedHelp: 2 }))).toBe(
      "answered all of the last 5 checks; blocked on 1 of them, and did not ask for help on it; asked for help on 2 other checks",
    );
  });
});
