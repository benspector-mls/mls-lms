import {
  DEFAULT_RETRY_WAIT_HOURS,
  describeRetryWait,
  latestAttempt,
  nextAttempt,
  retryWaitHoursOf,
  retryWaitParts,
} from "@/lib/checks/attempts";

/**
 * When a fellow may answer a check again. The server refuses with this rule, releases the exemplar
 * with it, and the fellow's screen draws with it, so a mistake here is three mistakes.
 */

const HOUR = 60 * 60 * 1000;
const start = new Date("2026-09-28T14:00:00Z");
const hoursAfter = (hours: number) => new Date(start.getTime() + hours * HOUR);

describe("nextAttempt", () => {
  it("opens the first attempt when there are none", () => {
    expect(nextAttempt([], DEFAULT_RETRY_WAIT_HOURS, start)).toEqual({ kind: "open", attempt: 1 });
  });

  it("makes the second attempt wait for the whole wait after the first", () => {
    const attempts = [{ attempt: 1, submittedAt: start }];

    expect(nextAttempt(attempts, 168, hoursAfter(1))).toEqual({
      kind: "waiting",
      attempt: 2,
      until: hoursAfter(168),
    });
    expect(nextAttempt(attempts, 168, hoursAfter(167.99))).toMatchObject({ kind: "waiting" });
    expect(nextAttempt(attempts, 168, hoursAfter(168))).toEqual({ kind: "open", attempt: 2 });
    expect(nextAttempt(attempts, 168, hoursAfter(200))).toEqual({ kind: "open", attempt: 2 });
  });

  it("uses the check's own wait, however short", () => {
    const attempts = [{ attempt: 1, submittedAt: start }];

    expect(nextAttempt(attempts, 1, hoursAfter(0.5))).toMatchObject({ kind: "waiting" });
    expect(nextAttempt(attempts, 1, hoursAfter(1))).toEqual({ kind: "open", attempt: 2 });
  });

  it("measures from the latest attempt, in whatever order the rows arrive", () => {
    const attempts = [
      { attempt: 2, submittedAt: hoursAfter(200) },
      { attempt: 1, submittedAt: start },
    ];

    expect(nextAttempt(attempts, 168, hoursAfter(250))).toEqual({
      kind: "waiting",
      attempt: 3,
      until: hoursAfter(368),
    });
  });

  it("is exhausted after three attempts, however long ago", () => {
    const attempts = [
      { attempt: 1, submittedAt: start },
      { attempt: 2, submittedAt: hoursAfter(200) },
      { attempt: 3, submittedAt: hoursAfter(400) },
    ];

    expect(nextAttempt(attempts, 168, hoursAfter(10_000))).toEqual({ kind: "exhausted" });
  });
});

describe("latestAttempt", () => {
  it("picks the highest number rather than the last row", () => {
    expect(latestAttempt([{ attempt: 3 }, { attempt: 1 }, { attempt: 2 }])).toEqual({
      attempt: 3,
    });
  });

  it("is null for no attempts", () => {
    expect(latestAttempt([])).toBeNull();
  });
});

describe("the wait between attempts", () => {
  it("round-trips between the form's days and hours and the stored hours", () => {
    for (const hours of [1, 23, 24, 25, 168, 170, 8784]) {
      expect(retryWaitHoursOf(retryWaitParts(hours))).toBe(hours);
    }
    expect(retryWaitParts(DEFAULT_RETRY_WAIT_HOURS)).toEqual({ days: 0, hours: 1 });
  });

  it("reads as a fellow would say it", () => {
    expect(describeRetryWait(168)).toBe("7 days");
    expect(describeRetryWait(24)).toBe("1 day");
    expect(describeRetryWait(30)).toBe("1 day and 6 hours");
    expect(describeRetryWait(1)).toBe("1 hour");
    expect(describeRetryWait(12)).toBe("12 hours");
  });
});
