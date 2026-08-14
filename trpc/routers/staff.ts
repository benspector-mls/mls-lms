import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { auditActor, recordEvent } from "@/lib/audit/record";
import { displayNameOf } from "@/lib/people";
import { inTransaction } from "@/lib/prisma";
import {
  inviteExpiry,
  inviteIsUsable,
  inviteState,
  newInviteToken,
  raiseRole,
  type StaffRole,
} from "@/lib/staff/invite";

import { adminProcedure, createTRPCRouter, profileProcedure } from "../init";

/**
 * Who may teach, and who may decide that.
 *
 * **Two mechanisms, because they answer two different questions.** `createInvite` is how somebody
 * *becomes* staff — it works before they have an account at all, which is the case that matters,
 * since a new hire has no reason to sign in to a system they cannot yet use. `setAdmin` is how an
 * account that already exists gains more, which is what makes "an admin can let other admins
 * invite people" actually reachable.
 *
 * Everything here is `adminProcedure` except the two an invitee calls. An instructor deciding who
 * else becomes an instructor is precisely the escalation this exists to prevent.
 *
 * **The database is the real guard, not this file.** Migration `20260730024911_tighten_profiles_grants`
 * exists because a signed-in student could once set their own `role` to `ADMIN` from browser
 * JavaScript. The role column must never be writable by the account it describes, and that is a
 * property of the grants — a correct procedure here is necessary and not sufficient.
 */
export const staffRouter = createTRPCRouter({
  /**
   * Everybody who can teach, with how much they hold.
   *
   * Students are not listed. This screen answers "who has staff access", and a cohort's students
   * are on that cohort's roster; a list of every account in the deployment would be a different
   * screen with a different reason to exist.
   */
  people: adminProcedure.query(async ({ ctx }) => {
    const people = await ctx.db.profile.findMany({
      where: { role: { in: ["INSTRUCTOR", "ADMIN"] } },
      // Admins first, then by name: the top of this list is who can act on it.
      orderBy: [{ role: "desc" }, { displayName: "asc" }, { email: "asc" }],
      select: {
        id: true,
        email: true,
        displayName: true,
        githubUsername: true,
        role: true,
        createdAt: true,
        /*
          Which cohorts they teach, rather than a count. Revoking somebody's admin does not
          un-teach them anything, so the courses are context for the decision rather than a
          consequence of it — and an instructor listed against no course is the interesting row,
          because it usually means an invitation was redeemed and nothing followed.
        */
        instructorOf: {
          select: { course: { select: { id: true, name: true, cohortTerm: true } } },
          orderBy: { course: { createdAt: "desc" } },
        },
      },
    });

    /*
      Counted here so the screen never has to work it out. It is what `setAdmin` refuses on, and a
      button that offers an action the procedure will refuse is worse than no button.
    */
    const adminCount = people.filter((person) => person.role === "ADMIN").length;

    return {
      people: people.map(({ instructorOf, ...person }) => ({
        ...person,
        courses: instructorOf.map((row) => row.course),
        /** Whether this is the caller, so the screen can say "you" and not offer self-demotion. */
        isYou: person.id === ctx.profile.id,
      })),
      adminCount,
    };
  }),

  /**
   * Every invitation, newest first, with the state the screen names.
   *
   * Redeemed ones are kept and shown rather than cleared out. "How did this person get access"
   * is a question that gets asked months later, and the answer is this row.
   */
  invites: adminProcedure.query(async ({ ctx }) => {
    const invites = await ctx.db.instructorInvite.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        token: true,
        expiresAt: true,
        redeemedAt: true,
        createdAt: true,
        createdBy: { select: { displayName: true, email: true } },
        redeemedBy: { select: { displayName: true, email: true, githubUsername: true } },
      },
    });

    // One instant for the whole list, so two rows on the same screen cannot disagree about
    // whether they have expired.
    const now = new Date();

    return invites.map((invite) => ({ ...invite, state: inviteState(invite, now) }));
  }),

  /** Generates an invitation. The token is the whole credential, so nothing else is asked for. */
  createInvite: adminProcedure.mutation(async ({ ctx }) => {
    const now = new Date();

    return inTransaction(ctx.db, async (tx) => {
      const invite = await tx.instructorInvite.create({
        data: {
          token: newInviteToken(),
          createdById: ctx.profile.id,
          expiresAt: inviteExpiry(now),
        },
        select: { id: true, token: true, expiresAt: true },
      });

      await recordEvent(tx, {
        action: "INVITE_CREATED",
        actor: auditActor(ctx),
        subject: { id: invite.id, label: "an instructor invitation" },
        // The token is deliberately not recorded. It is the whole credential, and a log that
        // holds live credentials is a second place they can be read from.
        detail: { expiresAt: invite.expiresAt.toISOString() },
      });

      return invite;
    });
  }),

  /**
   * Deletes an unused invitation, for a link that went to the wrong person.
   *
   * **A redeemed one is refused rather than deleted**, and that is the point of the check: the row
   * has stopped being a credential and become the record of somebody being given access. Deleting
   * it would remove the only trace of how they got in. Their access is revoked by `setAdmin` or by
   * changing their role, not by tidying this list.
   */
  revokeInvite: adminProcedure
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await ctx.db.instructorInvite.findUnique({
        where: { id: input.inviteId },
        select: { id: true, redeemedAt: true, redeemedBy: { select: { displayName: true } } },
      });

      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That invitation no longer exists." });
      }

      if (invite.redeemedAt !== null) {
        const who = invite.redeemedBy?.displayName ?? "somebody";
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `${who} has already used this invitation, so it is a record rather than a live ` +
            `link — it cannot be used again. Change their role on this screen to take their ` +
            `access away.`,
        });
      }

      /*
        Deleting the row removes the only trace that this invitation ever existed, which is
        precisely why the event is written in the same transaction. After this, the audit log is
        the record that somebody generated staff access and then withdrew it — a sequence worth
        being able to see, and one that leaves nothing behind in `instructor_invites`.
      */
      return inTransaction(ctx.db, async (tx) => {
        await tx.instructorInvite.delete({ where: { id: invite.id } });

        await recordEvent(tx, {
          action: "INVITE_REVOKED",
          actor: auditActor(ctx),
          subject: { id: invite.id, label: "an unused instructor invitation" },
        });

        return { id: invite.id };
      });
    }),

  /**
   * Grants or revokes admin on an account that is already staff.
   *
   * Only between INSTRUCTOR and ADMIN. Making a *student* staff is `createInvite`'s job, and
   * accepting a student id here would turn this screen into a way to promote any account in the
   * deployment — the invitation exists so that granting staff access is a deliberate act with a
   * record, and a second path without one would undo that.
   */
  setAdmin: adminProcedure
    .input(z.object({ profileId: z.string().uuid(), admin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.db.profile.findUnique({
        where: { id: input.profileId },
        // `githubUsername` is selected for the audit event's label rather than for the response:
        // it is the middle rung of `displayNameOf`'s fallback, and without it a person who set no
        // display name is recorded by email address instead of by the handle they are known as.
        select: { id: true, role: true, displayName: true, email: true, githubUsername: true },
      });

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That account no longer exists." });
      }

      if (target.role === "STUDENT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "That account is a student. Send them an instructor invitation instead — staff " +
            "access is granted through an invitation so that there is a record of it.",
        });
      }

      const next: StaffRole = input.admin ? "ADMIN" : "INSTRUCTOR";

      // Already there. Returned in the same shape as the update below, so a caller never has to
      // ask which branch answered.
      if (target.role === next) {
        return {
          id: target.id,
          role: target.role,
          displayName: target.displayName,
          email: target.email,
        };
      }

      /*
        **Revoking the last admin is refused.** It would lock every remaining person out of this
        screen permanently — there is no procedure that grants the first admin, by design, so the
        only way back is editing the database. The check is one count and the failure is not
        recoverable from inside the application.

        Counted rather than special-casing "is this me", because the dangerous case is not
        self-demotion: two admins revoking each other in either order is fine, and one admin
        revoking the only other one while also being the only other one is the same arithmetic.
      */
      if (!input.admin) {
        const admins = await ctx.db.profile.count({ where: { role: "ADMIN" } });
        if (admins <= 1) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "This is the only admin account. Removing it would leave nobody able to invite " +
              "staff or grant admin, and no way to fix it except editing the database. Make " +
              "somebody else an admin first.",
          });
        }
      }

      /*
        The change and its record commit together or not at all.

        A role change that succeeds while its audit event fails is the case the log exists to
        cover, so it is the one case it must not have. `recordEvent` takes the transaction for
        exactly this reason — see `lib/audit/record.ts`.
      */
      return inTransaction(ctx.db, async (tx) => {
        const updated = await tx.profile.update({
          where: { id: target.id },
          data: { role: next },
          select: { id: true, role: true, displayName: true, email: true },
        });

        await recordEvent(tx, {
          action: "ROLE_CHANGED",
          actor: auditActor(ctx),
          subject: { id: target.id, label: displayNameOf(target, "an account") },
          // Both ends, because "granted admin" and "revoked admin" are the same act with the
          // arrow reversed, and a record of only the new value cannot tell them apart.
          detail: { from: target.role, to: next },
        });

        return updated;
      });
    }),

  /**
   * What an invitation link points at, before it is redeemed.
   *
   * `profileProcedure`, because the caller has signed in and is by definition not yet staff — that
   * is what they are here to change. Returns null on an unknown token so a stale link reads as
   * "this link no longer works" rather than as an error page, and it deliberately does not name
   * who issued it: somebody holding a link they were not sent learns nothing from this.
   */
  previewInvite: profileProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const invite = await ctx.db.instructorInvite.findUnique({
        where: { token: input.token },
        select: { id: true, expiresAt: true, redeemedAt: true, redeemedById: true },
      });

      if (!invite) return null;

      const now = new Date();

      return {
        state: inviteState(invite, now),
        expiresAt: invite.expiresAt,
        /**
         * Whether this caller is the one who already used it, so opening a bookmarked link reads
         * as "you are already an instructor" rather than as a link that has been taken.
         */
        redeemedByYou: invite.redeemedById === ctx.profile.id,
        /** What the caller is now, so the screen can say what accepting would change. */
        yourRole: ctx.profile.role,
      };
    }),

  /**
   * Redeems an invitation, making the caller an instructor.
   *
   * **Raises the role and never lowers it.** An admin who opens an instructor link stays an admin
   * — and the person most likely to click one to see what it does is the admin who just generated
   * it. The obvious implementation, `role: 'INSTRUCTOR'`, silently demotes them.
   *
   * **Single use, enforced by a conditional update rather than a read.** `updateMany` with
   * `redeemedAt: null` in the `where` is what makes two simultaneous redemptions resolve to one
   * winner: the second matches no rows. Reading the invitation and then writing it would leave a
   * window where both callers saw it unused, and this is the one credential in the application
   * where two people getting in on one link matters.
   */
  redeemInvite: profileProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const invite = await ctx.db.instructorInvite.findUnique({
        where: { token: input.token },
        select: { id: true, expiresAt: true, redeemedAt: true, redeemedById: true },
      });

      if (!invite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This invitation link is not valid. Ask whoever sent it for a new one.",
        });
      }

      // Opening a bookmarked link again is not an error, and telling somebody who is already an
      // instructor that their link is used would be a confusing way to say "you are fine".
      if (invite.redeemedById === ctx.profile.id) {
        return { role: ctx.profile.role, alreadyRedeemed: true as const };
      }

      const now = new Date();

      if (!inviteIsUsable(invite, now)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            invite.redeemedAt !== null
              ? "This invitation has already been used. Ask for a new one."
              : "This invitation has expired. Ask for a new one.",
        });
      }

      return inTransaction(ctx.db, async (tx) => {
        const claimed = await tx.instructorInvite.updateMany({
          where: { id: invite.id, redeemedAt: null },
          data: { redeemedAt: now, redeemedById: ctx.profile.id },
        });

        // Somebody else took it between the read above and this write.
        if (claimed.count === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "This invitation has already been used. Ask for a new one.",
          });
        }

        const role = raiseRole(ctx.profile.role as StaffRole, "INSTRUCTOR");

        // Skipped entirely when the caller already outranks it, so an admin redeeming one does
        // not even write to their own row.
        if (role !== ctx.profile.role) {
          await tx.profile.update({ where: { id: ctx.profile.id }, data: { role } });
        }

        /*
          The actor and the subject are the same person here, and that is worth recording rather
          than collapsing: this is the one act in the application where somebody grants themselves
          access, and what makes it legitimate is the invitation rather than who performed it. The
          invitation's id is in `detail` so the event can be read against `createInvite`'s — which
          together say who opened the door and who walked through it.
        */
        await recordEvent(tx, {
          action: "INVITE_REDEEMED",
          actor: auditActor(ctx),
          subject: { id: ctx.profile.id, label: displayNameOf(ctx.profile, "an account") },
          detail: { inviteId: invite.id, from: ctx.profile.role, to: role },
        });

        return { role, alreadyRedeemed: false as const };
      });
    }),
});
