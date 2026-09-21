/**
 * The one rule that removes a stored object, exercised without a bucket.
 *
 * This is the rule that deletes fellows' files, so every branch that removes something is asserted
 * beside the branch that would have kept it — the difference between the two is a folder id being
 * in one table or another, and getting that wrong is silent.
 */
import { MINIMUM_AGE_MS, judgeStoredObjects, type KnownRows } from "@/lib/uploads/reconcile";

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const OLD = new Date(NOW - MINIMUM_AGE_MS - 60_000);
const YOUNG = new Date(NOW - 60_000);

const SUBMISSION = "11111111-1111-4111-8111-111111111111";
const GRADED = "22222222-2222-4222-8222-222222222222";
const UPDATE = "33333333-3333-4333-8333-333333333333";
const NOBODY = "44444444-4444-4444-8444-444444444444";

const known: KnownRows = {
  submissions: new Map([
    [SUBMISSION, { graded: false }],
    [GRADED, { graded: true }],
  ]),
  updates: new Set([UPDATE]),
  attached: new Set([`${SUBMISSION}/kept.pdf`, `${UPDATE}/kept.png`]),
};

const judge = (path: string, createdAt: Date | null = OLD) =>
  judgeStoredObjects([{ path, sizeBytes: 10, createdAt }], known, NOW)[0]!;

describe("judgeStoredObjects", () => {
  it("keeps an object some row names, from either table", () => {
    expect(judge(`${SUBMISSION}/kept.pdf`)).toMatchObject({
      keep: true,
      reason: "attached to a row",
    });
    expect(judge(`${UPDATE}/kept.png`)).toMatchObject({ keep: true, reason: "attached to a row" });
  });

  it("removes an object under an update that no attachment names, once it is old enough", () => {
    expect(judge(`${UPDATE}/stray.png`)).toMatchObject({
      keep: false,
      reason: "taken off the goal update or never recorded",
    });
  });

  it("removes an object under a submission that no artifact names", () => {
    expect(judge(`${SUBMISSION}/stray.pdf`)).toMatchObject({
      keep: false,
      reason: "taken off the submission or never recorded",
    });
  });

  /*
    The reason the rule is not "delete what no row names": feedback was written about this file.
  */
  it("keeps everything under a graded submission, named or not", () => {
    expect(judge(`${GRADED}/stray.pdf`)).toMatchObject({
      keep: true,
      reason: "a grade was written on this work",
    });
  });

  it("removes an object whose folder is in neither table", () => {
    expect(judge(`${NOBODY}/stray.pdf`)).toMatchObject({
      keep: false,
      reason: "no row names this folder",
    });
  });

  it("touches nothing young, and nothing it cannot date", () => {
    expect(judge(`${NOBODY}/fresh.pdf`, YOUNG)).toMatchObject({
      keep: true,
      reason: "less than a day old",
    });
    expect(judge(`${UPDATE}/undated.png`, null)).toMatchObject({
      keep: true,
      reason: "no creation time to judge its age by",
    });
  });

  it("says what the object is before how old it is", () => {
    // A named object is kept for being named, not for being young.
    expect(judge(`${UPDATE}/kept.png`, YOUNG).reason).toBe("attached to a row");
  });
});
