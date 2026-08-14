import "server-only";

import { TRPCError } from "@trpc/server";

import type { Tx } from "../prisma";

/**
 * Who is expected in a cohort, and whether the person holding the link is one of them.
 *
 * **The allowlist half of joining.** A join link is unguessable, which is not the same as private:
 * it is sent into a group chat or an email thread and forwarded from there. On its own it was the
 * whole credential, and the controls were after the fact — rotate the link, remove whoever got in.
 * With a roster it is necessary and not sufficient, and the two failures it used to have (a
 * stranger who is sent it, a student who forwards it to a friend) both stop before an enrollment
 * row exists.
 *
 * Its own module rather than lines inside `enrollments.ts`, for the reason `membership.ts` is one:
 * the preview screen and the join mutation have to ask the identical question. A screen that says
 * "you can join this" over a mutation that then refuses is worse than no preview at all.
 */

/**
 * A roster key as it is stored and compared: trimmed, lowercased, or null when there is nothing.
 *
 * **Both keys go through here on the way in and on the way out**, which is the only reason a
 * lookup matches. GitHub logins are case-insensitive and the signup trigger records whatever
 * casing GitHub reported, so `Ben-Spector` in the roster and `ben-spector` on the profile are the
 * same person and would otherwise be two. The database carries a CHECK constraint saying the
 * stored value equals its own lowercase, so a path that skips this fails loudly rather than
 * writing a row nothing can find.
 */
export function rosterKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/** Enough of a profile to match against a roster. */
export type RosterCandidate = {
  id: string;
  githubUsername: string | null;
  email: string | null;
};

/** A matched entry, and what it was expected under. */
export type RosterMatch = {
  id: string;
  note: string | null;
  githubUsername: string | null;
  email: string | null;
  claimedById: string | null;
};

/**
 * The entry that admits this person to this course, or null.
 *
 * **Either key matches, and that is deliberate.** Each fails in a way the other covers: a student
 * who renames their GitHub account between the roster being written and their first sign-in no
 * longer matches by login, and a student whose GitHub email is private presents a
 * `users.noreply.github.com` address that was never on any roster. Requiring both would refuse
 * real students for reasons neither they nor their instructor can see.
 *
 * **Unclaimed, or claimed by this same person.** The second half is what makes a removed student
 * restorable and a bookmarked link harmless: they already hold their entry, so they go on matching
 * it. What it refuses is a second person arriving on an entry somebody else has already used.
 */
export async function findRosterMatch(
  db: Tx,
  courseId: string,
  candidate: RosterCandidate,
): Promise<RosterMatch | null> {
  const githubUsername = rosterKey(candidate.githubUsername);
  const email = rosterKey(candidate.email);

  const keys = [...(githubUsername ? [{ githubUsername }] : []), ...(email ? [{ email }] : [])];

  // An account with neither a GitHub login nor an address cannot be on a roster, and asking the
  // database `OR []` would match every row rather than none.
  if (keys.length === 0) return null;

  return db.rosterEntry.findFirst({
    where: {
      courseId,
      AND: [{ OR: keys }, { OR: [{ claimedById: null }, { claimedById: candidate.id }] }],
    },
    select: { id: true, note: true, githubUsername: true, email: true, claimedById: true },
    // A student named by both keys in two separate entries takes the one already theirs, so a
    // second visit does not claim a second row.
    orderBy: { claimedById: { sort: "desc", nulls: "last" } },
  });
}

/**
 * Whether the roster applies to this caller at all.
 *
 * **Staff are exempt, and it is worth saying why rather than leaving it implied.** An instructor
 * or an admin holding a join link may legitimately want to sit in a cohort, and requiring them to
 * write themselves onto its roster first would be friction with nothing behind it: an admin can
 * add that row, and an instructor of the course can too. The rule the roster actually enforces is
 * about strangers, and staff are not strangers — they already reach every cohort's grades.
 *
 * So the guarantee is "everybody enrolled as a student was expected by name, or is staff", which
 * is narrower than it first reads and is the honest version.
 */
export function rosterApplies(role: string): boolean {
  return role !== "INSTRUCTOR" && role !== "ADMIN";
}

/**
 * Claims an entry for this person, and refuses if somebody else got there first.
 *
 * **A conditional update rather than a read and then a write**, the same shape `redeemInvite` uses
 * and for the same reason: two people matching one entry in the same moment would both see it
 * unclaimed, and the window between checking and writing is exactly where the second one gets in.
 * `updateMany` with the claim state in the `where` resolves that at the database — the loser
 * matches no rows.
 *
 * Idempotent for the person who already holds it, so a removed-and-restored student re-claiming
 * their own entry is not a conflict.
 */
export async function claimRosterEntry(
  db: Tx,
  entryId: string,
  profileId: string,
): Promise<boolean> {
  const claimed = await db.rosterEntry.updateMany({
    where: { id: entryId, OR: [{ claimedById: null }, { claimedById: profileId }] },
    data: { claimedById: profileId, claimedAt: new Date() },
  });

  return claimed.count > 0;
}

/**
 * The refusal, worded for the student reading it.
 *
 * **Says what to do and does not say what is on the roster.** "This link is not for your account"
 * is actionable; listing who is expected would let anybody holding a link read a cohort's roster,
 * which is the thing the link was not supposed to be worth.
 *
 * It names the GitHub account they arrived as, because the common cause is not exclusion — it is
 * a student who signed in with a personal account when their instructor wrote down a different
 * handle, and they cannot see which one they used without being told.
 */
export function rosterRefusal(courseName: string, candidate: RosterCandidate): TRPCError {
  const signedInAs = candidate.githubUsername
    ? `You are signed in as @${candidate.githubUsername}.`
    : candidate.email
      ? `You are signed in as ${candidate.email}.`
      : "Your account has no GitHub login or email address on it.";

  return new TRPCError({
    code: "FORBIDDEN",
    message:
      `This link is for ${courseName}, and your account is not on its list of expected ` +
      `students. ${signedInAs} If you usually use a different GitHub account, sign out and ` +
      `try again with that one — otherwise ask your instructor to add you.`,
  });
}
