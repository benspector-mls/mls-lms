import { newJoinToken } from "../courses/join-token";

/**
 * The policy an instructor invitation follows, as pure functions.
 *
 * Separated from the router so the rules can be checked without a database. What an invitation
 * *is* — a credential that grants staff access to every course and every student's grade — makes
 * the two rules below worth stating rather than leaving implied in a `where` clause.
 */

/**
 * How long an invitation is good for.
 *
 * Short, because the link is the whole credential and there is no second factor. A week covers
 * "I sent it Monday, they started Thursday" and does not cover a link sitting in a mailbox for a
 * term. An admin who needs longer generates another one, which costs a click.
 */
export const INVITE_LIFETIME_DAYS = 7;

/** A random, unguessable token — the same generator as a course join link. */
export function newInviteToken(): string {
  return newJoinToken();
}

/** When an invitation created now should stop working. */
export function inviteExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * What state an invitation is in, which is the whole of the screen's vocabulary.
 *
 * Order matters: **redeemed beats expired.** An invitation that was used and has since passed its
 * expiry is a record of somebody being given access, and calling it "expired" would hide the one
 * fact worth keeping — who got in, and when. Expiry only describes a link nobody used.
 */
export type InviteState = "redeemed" | "expired" | "open";

export function inviteState(
  invite: { redeemedAt: Date | null; expiresAt: Date },
  now: Date,
): InviteState {
  if (invite.redeemedAt !== null) return "redeemed";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "open";
}

/** Whether this invitation can still be used. The one question `redeem` asks. */
export function inviteIsUsable(
  invite: { redeemedAt: Date | null; expiresAt: Date },
  now: Date,
): boolean {
  return inviteState(invite, now) === "open";
}

/**
 * Which of two roles is higher, so redeeming can raise and never lower.
 *
 * **An admin who opens an instructor link stays an admin.** Stated as a function because the
 * obvious implementation is `role = 'INSTRUCTOR'`, which silently demotes — and the person most
 * likely to click an invitation link to see what it does is the admin who just generated it.
 */
const RANK = { STUDENT: 0, INSTRUCTOR: 1, ADMIN: 2 } as const;
export type StaffRole = keyof typeof RANK;

export function raiseRole(current: StaffRole, atLeast: StaffRole): StaffRole {
  return RANK[current] >= RANK[atLeast] ? current : atLeast;
}
