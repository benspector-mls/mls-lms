import "server-only";

import type { Prisma } from "../generated/prisma/client";
import type { Tx } from "../prisma";
import type { HandInAfter } from "./hand-in";

/**
 * What a team hands in, and which of its rows carries what.
 *
 * A team's submission is one row per member. **One row holds the work** — the repository, the
 * pull request, the pasted link, the uploaded file, and every grading draft and test run — and
 * the rest are **mirrors** pointing at it through `teamSubmissionId`, carrying status and
 * outcome and nothing about where the work is. Every member keeping a row is what lets the
 * gradebook, the CSV export, a student's own feedback page and the Salesforce columns go on
 * reading one row per student.
 *
 * This module is the one place that knows the split. It exists for the reason `hand-in.ts`
 * exists: the rule would otherwise be written at four call sites — two hand-in procedures, the
 * upload route, and the webhook — and a rule written four times is four rules. In particular
 * **no call site chooses what a mirror receives.** A caller says where the work is and what the
 * work is called; which of those two reaches a mirror is decided here, once.
 *
 * Nothing here imports anything that runs. Every function takes the client to write through,
 * which is what lets a check script drive a whole hand-in inside a transaction it then rolls
 * back, and what lets the pure half be unit-tested without a database.
 */

// ===========================================================================
// Reading: which kind of row is this
// ===========================================================================

/** What a submission is to its team, or that it has none. */
export type TeamRole = "individual" | "holds-the-work" | "mirror";

/** The two columns that decide it. */
export type RoleShape = {
  teamId: string | null;
  teamSubmissionId: string | null;
};

/**
 * Whether this row is individual work, the row holding a team's work, or one member's mirror.
 *
 * `teamSubmissionId` is read first and decides on its own: a row pointing at another is a mirror
 * whatever else it holds. A row with a team and no pointer holds that team's work — there is
 * exactly one per team per assignment, which a partial unique index enforces rather than this.
 */
export function teamRole(submission: RoleShape): TeamRole {
  if (submission.teamSubmissionId !== null) return "mirror";
  return submission.teamId === null ? "individual" : "holds-the-work";
}

/** Whether the reads that answer "what is waiting on an instructor" should skip this row. */
export function isMirror(submission: RoleShape): boolean {
  return teamRole(submission) === "mirror";
}

// ===========================================================================
// Writing: a hand-in, and the part of it every member sees
// ===========================================================================

/**
 * One hand-in, in two halves that are deliberately named for who sees them.
 *
 * The split is the whole point of this type. `location` is where the work is, and it belongs to
 * the one row that holds it: on five rows, `repoUrl` is five chances to be stale, and
 * `headSha != gradedHeadSha` would read as "pushed since graded" forever on a row that has
 * neither. `describe` is what the work is *called*, which every member's own page shows, so it
 * is copied — reading it through the relation for one filename would be a join for nothing.
 */
export type HandIn = {
  /** From `handInState`. Status, when it was first handed in, and whether that was late. */
  state: HandInAfter;
  /** When something last happened here, which is what the grading pile is ordered by. */
  lastActivityAt: Date;
  /**
   * Which member handed in the version now standing, or null when nobody can be named — work
   * that predates the column, or a pull request opened by an account matching no member.
   */
  handedInById: string | null;
  /** Where the work is. Written only to the row that holds it. */
  location?: Prisma.SubmissionUncheckedUpdateInput;
  /** What the work is called. Written to every member's row. */
  describe?: {
    uploadFilename?: string | null;
    uploadSizeBytes?: number | null;
    uploadContentType?: string | null;
  };
};

/**
 * Everything a mirror carries, as a select.
 *
 * The state of the work and nothing about where it is. One list rather than one per act, so a
 * column added to what a member sees cannot reach the hand-in fan-out and miss a member who joins
 * the team afterwards — those are the same question and this is the one answer.
 *
 * `feedbackReviewedAt` is deliberately absent, and is the only column here that could be
 * mistaken for belonging: each member reads their own report and says so on their own row.
 * `salesforceSync*` likewise — each member's record syncs on its own.
 */
export const MIRRORED_COLUMNS = {
  status: true,
  submittedAt: true,
  isLate: true,
  lastActivityAt: true,
  handedInById: true,
  uploadFilename: true,
  uploadSizeBytes: true,
  uploadContentType: true,
  finalScore: true,
  finalScorePossible: true,
  isComplete: true,
  feedbackMarkdown: true,
  gradedById: true,
  gradedAt: true,
  gradedHeadSha: true,
} satisfies Prisma.SubmissionSelect;

/**
 * The columns every member of a team carries after a hand-in.
 *
 * Pure, and exported so a test can assert the one property that matters: **nothing naming where
 * the work is may appear here.** That is the failure this whole module exists to prevent, and it
 * is invisible in every other way — a mirror carrying a stale `repoUrl` looks like a working
 * screen right up until somebody opens last week's commit.
 */
/*
  The **unchecked** input, which is the variant that admits a foreign-key column as a plain
  value. `handedInById` names a relation, so Prisma keeps it out of the checked one — as it does
  `gradedById`, which the grade fan-out will want for the same reason.
*/
export function sharedAfterHandIn(handIn: HandIn): Prisma.SubmissionUncheckedUpdateManyInput {
  return {
    status: handIn.state.status,
    submittedAt: handIn.state.submittedAt,
    isLate: handIn.state.isLate,
    lastActivityAt: handIn.lastActivityAt,
    handedInById: handIn.handedInById,
    ...handIn.describe,
  };
}

/**
 * Records a hand-in on the row that holds the work, and on every mirror of it.
 */
export async function recordHandIn(
  db: Tx,
  params: { submissionId: string; handIn: HandIn },
): Promise<void> {
  await write(db, params.submissionId, sharedAfterHandIn(params.handIn), params.handIn.location);
}

/**
 * Records that something happened to the work without anything being handed in.
 *
 * One caller: a commit pushed to a pull request that is already open. **That is deliberately not
 * a hand-in** — students push while they work, and if every push re-submitted, a graded
 * submission would drop back into the queue because somebody fixed a typo. So the status, the
 * time it was handed in, and who handed it in are all left exactly as they stand, and what moves
 * is where the work is and when it last moved.
 *
 * Its own act rather than a hand-in with fields left out, because "nothing was handed in" is a
 * different claim from "this was handed in, and here is what by whom" — and a hand-in whose
 * status could be omitted is one a caller could omit it from by mistake.
 */
export async function recordActivity(
  db: Tx,
  params: {
    submissionId: string;
    at: Date;
    /** Where the work is now. Written only to the row that holds it. */
    location?: Prisma.SubmissionUncheckedUpdateInput;
  },
): Promise<void> {
  await write(db, params.submissionId, { lastActivityAt: params.at }, params.location);
}

/**
 * The two statements every act above ends in: the row holding the work, then its mirrors.
 *
 * Private, and the only place either is written, so `shared` cannot reach one and miss the other.
 * No transaction around them, for two reasons. Prisma refuses a nested interactive transaction,
 * so opening one here would fail outright for every caller already inside one — which is every
 * check script. And doing without one is safe because these are not halves of a value: the row
 * holding the work is the record, and a mirror that missed an update reads as one round behind
 * rather than as something that never happened. The next write, or the approval, catches it up.
 *
 * **Individual work takes the same path.** Its `updateMany` matches nothing, because no row points
 * at it, so there is one code path rather than a branch that could be taken wrongly.
 */
async function write(
  db: Tx,
  submissionId: string,
  shared: Prisma.SubmissionUncheckedUpdateManyInput,
  location?: Prisma.SubmissionUncheckedUpdateInput,
): Promise<void> {
  await db.submission.update({
    where: { id: submissionId },
    data: { ...shared, ...location },
  });

  await db.submission.updateMany({
    where: { teamSubmissionId: submissionId },
    data: shared,
  });
}

/**
 * Records a student declaring graded work ready to be looked at again.
 *
 * Its own act rather than a hand-in, because nothing was handed in: no link, no file, no commit.
 * What changes is that somebody is asking, so `submittedAt` and `isLate` are deliberately left
 * exactly as they are — the work was handed in when it was handed in, and asking for another look
 * is not a new answer to that.
 *
 * On a team it reaches every member, because a resubmission is the team's and their gradebook
 * cells have to agree with the pile the instructor is looking at.
 */
export async function recordResubmissionDeclared(
  db: Tx,
  params: { submissionId: string; at: Date },
): Promise<void> {
  const data = { status: "RESUBMITTED" as const, lastActivityAt: params.at };

  await db.submission.update({ where: { id: params.submissionId }, data });
  await db.submission.updateMany({
    where: { teamSubmissionId: params.submissionId },
    data,
  });
}

// ===========================================================================
// Resolving: whose team, and which row holds its work
// ===========================================================================

/** A team as the rest of the application needs to name it. */
export type ResolvedTeam = { id: string; name: string; teamSetId: string };

/**
 * The team a student is on for one assignment's set, or null if they are on none.
 *
 * Read from the student's own membership rather than from a team id handed in, which is what
 * makes it impossible for a caller to name somebody else's team. Active enrollments only: a
 * fellow who has left the cohort is on no team for the purpose of handing anything in, even
 * though their membership row is deliberately kept so that restoring them puts them back.
 */
export async function teamForStudent(
  db: Tx,
  params: { teamSetId: string; studentId: string },
): Promise<ResolvedTeam | null> {
  const membership = await db.teamMembership.findFirst({
    where: {
      teamSetId: params.teamSetId,
      enrollment: { studentId: params.studentId, status: "ACTIVE" },
    },
    select: { team: { select: { id: true, name: true, teamSetId: true } } },
  });

  return membership?.team ?? null;
}

/**
 * The row holding a team's work for one assignment, or null before anybody has started.
 *
 * `teamSubmissionId: null` is what distinguishes it from its own mirrors, and the partial unique
 * index is why `findFirst` is enough — there is at most one.
 */
export async function teamSubmissionFor(
  db: Tx,
  params: { assignmentId: string; teamId: string },
): Promise<{ id: string } | null> {
  return db.submission.findFirst({
    where: { assignmentId: params.assignmentId, teamId: params.teamId, teamSubmissionId: null },
    select: { id: true },
  });
}

/** Whether an error is Postgres refusing a duplicate through Prisma. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2002";
}

/** Which row holds a team's work, and whether this call is what made it so. */
export type ClaimedTeamWork = { submissionId: string; claimedNow: boolean };

/**
 * Finds the row holding this team's work, or makes the caller's row it.
 *
 * **The first member to arrive claims it, and the rest join.** Which member that is does not
 * matter and is not recorded as anything: the row is where the team's work lives from then on,
 * and who handed in the version now standing is `handedInById`, which moves. What must not happen
 * is two rows each holding a repository for one team, both graded — and that is refused by a
 * partial unique index on `(assignment_id, team_id)` rather than by anything here.
 *
 * So the race is settled by losing it. Two members pressing Accept in the same moment both read
 * no team row, both try to claim, and the loser is refused with `P2002` — at which point it looks
 * again and finds the winner's row, which is what it wanted in the first place. Twice round is
 * enough: a second refusal would mean the winner's row vanished between the write and the read,
 * which nothing in this application does.
 *
 * The update branch sets `teamSubmissionId: null` deliberately, which is what lets a member who
 * is already a mirror adopt the work — and if the team's row exists after all, the same index
 * refuses that too and the loop finds it. **It does not touch `status`**, which is what keeps
 * adopting a row from turning a released grade back into fresh work: what a hand-in means is
 * `handInStatus`'s to decide from the status it finds, and this must not have changed it first.
 */
export async function claimTeamWork(
  db: Tx,
  params: {
    assignmentId: string;
    studentId: string;
    team: ResolvedTeam;
    /**
     * The status a row created here is born with.
     *
     * `ACCEPTED` where accepting is a real act — a repository was generated, a copy prompt was
     * handed over. `NOT_STARTED` where the row exists only because the bytes need somewhere to
     * go, which is the upload and link kinds: if storing them then fails, the row says nothing
     * happened, which is true. Nothing here can pick between those, so the caller does.
     */
    statusIfNew: "ACCEPTED" | "NOT_STARTED";
  },
): Promise<ClaimedTeamWork> {
  const { assignmentId, studentId, team } = params;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const held = await teamSubmissionFor(db, { assignmentId, teamId: team.id });
    if (held) return { submissionId: held.id, claimedNow: false };

    try {
      const claimed = await db.submission.upsert({
        where: { assignmentId_studentId: { assignmentId, studentId } },
        create: {
          assignmentId,
          studentId,
          status: params.statusIfNew,
          teamId: team.id,
          teamSetId: team.teamSetId,
        },
        update: {
          teamId: team.id,
          teamSetId: team.teamSetId,
          teamSubmissionId: null,
        },
        select: { id: true },
      });
      return { submissionId: claimed.id, claimedNow: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Somebody claimed it between the read and the write. Round again and find their row.
    }
  }

  const held = await teamSubmissionFor(db, { assignmentId, teamId: team.id });
  if (held) return { submissionId: held.id, claimedNow: false };

  throw new Error(
    `Could not find or claim the row holding ${team.name}'s work on assignment ${assignmentId}.`,
  );
}

/**
 * Gives every active member of a team a row, mirroring the one that holds the work.
 *
 * Called after the work's own row exists, and again whenever a member turns up who has none — a
 * fellow placed on the team after it started, or one restored to the cohort. Idempotent, so the
 * caller does not have to know which of those it is.
 *
 * `createMany` with `skipDuplicates`, not an upsert loop. `@@unique([assignmentId, studentId])`
 * is what makes the skip correct: a member who already holds a row for this assignment keeps it,
 * whatever it says. That is deliberate rather than convenient — somebody who handed the work in
 * alone before the assignment became team work has a row with their own repository in it, and
 * overwriting it is not this function's decision to make.
 *
 * It also cannot create a second row holding the work, because every row it writes names
 * `teamSubmissionId`.
 */
export async function ensureTeamRows(
  db: Tx,
  params: {
    assignmentId: string;
    teamId: string;
    teamSetId: string;
    /** The row holding the work. Every row created here points at it. */
    teamSubmissionId: string;
  },
): Promise<number> {
  const members = await db.teamMembership.findMany({
    where: { teamId: params.teamId, enrollment: { status: "ACTIVE" } },
    select: { enrollment: { select: { studentId: true } } },
  });

  const held = await db.submission.findMany({
    where: { assignmentId: params.assignmentId },
    select: { studentId: true },
  });
  const alreadyHasARow = new Set(held.map((row) => row.studentId));

  const missing = members
    .map((membership) => membership.enrollment.studentId)
    .filter((studentId) => !alreadyHasARow.has(studentId));

  if (missing.length === 0) return 0;

  /*
    **A mirror is born carrying whatever it is a copy of.** Read from the row holding the work
    rather than seeded with a default, because the alternative is a member whose own row says
    nothing has happened while their team's says it was handed in and graded — which is what a
    member placed on a team mid-project would see, and what every screen keyed by student would
    then report about them.

    It also makes the order of writes stop mattering: called before a hand-in the rows are
    accurate, and called after it they are too.
  */
  const holdsTheWork = await db.submission.findUniqueOrThrow({
    where: { id: params.teamSubmissionId },
    select: MIRRORED_COLUMNS,
  });

  const created = await db.submission.createMany({
    data: missing.map((studentId) => ({
      ...holdsTheWork,
      assignmentId: params.assignmentId,
      studentId,
      teamId: params.teamId,
      teamSetId: params.teamSetId,
      teamSubmissionId: params.teamSubmissionId,
    })),
    skipDuplicates: true,
  });

  return created.count;
}
