import { handInState } from "@/lib/submissions/hand-in";
import { isMirror, sharedAfterHandIn, teamRole, type HandIn } from "@/lib/submissions/team";

/**
 * What a team hands in, and which of its rows carries what.
 *
 * The one property worth holding is the split: **nothing naming where the work is may reach a
 * mirror.** Getting it wrong is invisible in every other way — a mirror carrying a stale
 * `repoUrl` looks like a working screen right up until somebody opens last week's commit, and a
 * mirror carrying `headSha` reads as "pushed since graded" forever, because its `gradedHeadSha`
 * is null and always will be.
 */

const handIn = (over: Partial<HandIn> = {}): HandIn => ({
  state: { status: "SUBMITTED", submittedAt: new Date("2026-09-01T12:00:00Z"), isLate: false },
  lastActivityAt: new Date("2026-09-01T12:00:00Z"),
  handedInById: "cara",
  ...over,
});

describe("teamRole", () => {
  it("reads a row with no team as individual work", () => {
    expect(teamRole({ teamId: null, teamSubmissionId: null })).toBe("individual");
  });

  it("reads a row with a team and no pointer as the one holding the work", () => {
    expect(teamRole({ teamId: "team-3", teamSubmissionId: null })).toBe("holds-the-work");
  });

  it("reads a row pointing at another as a mirror", () => {
    expect(teamRole({ teamId: "team-3", teamSubmissionId: "the-work" })).toBe("mirror");
  });

  it("reads the pointer first, whatever else the row holds", () => {
    // Defensive: a mirror with no team cannot exist, because a CHECK constraint refuses it. If
    // one ever did, it is still a mirror and still waiting on nobody — which is the safe answer.
    expect(teamRole({ teamId: null, teamSubmissionId: "the-work" })).toBe("mirror");
  });

  it("is what isMirror asks", () => {
    expect(isMirror({ teamId: "team-3", teamSubmissionId: "the-work" })).toBe(true);
    expect(isMirror({ teamId: "team-3", teamSubmissionId: null })).toBe(false);
    expect(isMirror({ teamId: null, teamSubmissionId: null })).toBe(false);
  });
});

describe("sharedAfterHandIn", () => {
  it("carries the status, the hand-in time, the lateness, and who handed it in", () => {
    expect(sharedAfterHandIn(handIn())).toEqual({
      status: "SUBMITTED",
      submittedAt: new Date("2026-09-01T12:00:00Z"),
      isLate: false,
      lastActivityAt: new Date("2026-09-01T12:00:00Z"),
      handedInById: "cara",
    });
  });

  it("carries what the work is called, which every member's own page shows", () => {
    const shared = sharedAfterHandIn(
      handIn({
        describe: {
          uploadFilename: "wireframes.pdf",
          uploadSizeBytes: 20_000,
          uploadContentType: "application/pdf",
        },
      }),
    );
    expect(shared.uploadFilename).toBe("wireframes.pdf");
    expect(shared.uploadSizeBytes).toBe(20_000);
  });

  it("carries nothing about where the work is", () => {
    // The test this file exists for. Every one of these belongs to the single row holding the
    // work: on five rows each is five chances to be stale, and a mirror with a `headSha` and no
    // `gradedHeadSha` reads as "pushed since graded" for good.
    const shared = sharedAfterHandIn(
      handIn({
        location: {
          repoFullName: "marcy/fs-oct-2026-project-team-3",
          repoUrl: "https://github.com/marcy/fs-oct-2026-project-team-3",
          prNumber: 4,
          prUrl: "https://github.com/marcy/fs-oct-2026-project-team-3/pull/4",
          headBranch: "draft",
          headSha: "abc1234",
          submittedUrl: "https://docs.google.com/document/d/xyz",
          uploadPath: "sub-1/abcd.pdf",
        },
      }),
    );

    for (const column of [
      "repoFullName",
      "repoUrl",
      "prNumber",
      "prUrl",
      "headBranch",
      "headSha",
      "submittedUrl",
      "uploadPath",
    ]) {
      expect(shared).not.toHaveProperty(column);
    }
  });

  it("names a null hander rather than leaving the column alone", () => {
    // A pull request opened by an account matching no member of the team. Null has to be written
    // rather than omitted, or every member's page goes on naming whoever handed in last time.
    expect(sharedAfterHandIn(handIn({ handedInById: null }))).toHaveProperty("handedInById", null);
  });

  it("passes a revision's state through unchanged from handInState", () => {
    // The two rules compose rather than overlapping: `handInState` decides what a hand-in means,
    // and this decides who is told. A revision stays a revision on every member's row.
    const state = handInState({
      current: { status: "GRADED", submittedAt: new Date("2026-09-01T12:00:00Z"), isLate: false },
      dueAt: new Date("2026-09-02T12:00:00Z"),
      now: new Date("2026-09-05T12:00:00Z"),
    });

    const shared = sharedAfterHandIn(handIn({ state }));
    expect(shared.status).toBe("RESUBMITTED");
    // Handed in before the deadline, revised after it, and still not late — on every row.
    expect(shared.submittedAt).toEqual(new Date("2026-09-01T12:00:00Z"));
    expect(shared.isLate).toBe(false);
  });
});
