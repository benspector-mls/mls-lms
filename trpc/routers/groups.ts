import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertTeaches } from "@/lib/courses/membership";

import { createTRPCRouter, instructorProcedure } from "../init";

/**
 * The groups of a course: create, rename, remove, and who is in one.
 *
 * A group is a named set of this course's students and nothing else. It has no instructor, it
 * grants no permission, and it decides nothing about who may grade — an instructor picks one
 * and the four screens that answer "what is left" narrow to it. Splitting a cohort between
 * co-teachers is what it is for, and that works because the piles stop overlapping rather than
 * because anything is refused: a co-teacher covering for somebody else must still be able to
 * approve their drafts, so nothing here is ever consulted for permission.
 *
 * **Instructor-only, and student-facing nowhere.** There is no procedure here a student can
 * call, deliberately. Showing somebody their groupmates is the first read that would disclose a
 * slice of a roster to the cohort, and it only starts to matter when students work together —
 * so it arrives with group assignments, and it wants deciding per group rather than for all of
 * them. A group that exists only to split the marking is not meant to be seen.
 *
 * Every write is `instructorProcedure` *and* `assertTeaches`. The role alone would let one
 * cohort's instructor regroup another's students. There is no owner check anywhere: groups are
 * not owned, so there is nothing here for ownership to gate.
 */

/** Trimmed, because " Squad 1" and "Squad 1" are the same group to everyone but the database. */
const groupName = z.string().trim().min(1, "A group needs a name.").max(120);

/**
 * The group, if the caller teaches the course it belongs to.
 *
 * Loading the row first is what makes the course-level check possible at all: the mutations
 * below take a group id, and a group id says nothing about which course it is in until the row
 * is read.
 */
async function loadTeachableGroup(
  ctx: { db: typeof import("@/lib/prisma").db; profile: { id: string; role: string } },
  groupId: string,
) {
  const found = await ctx.db.courseGroup.findUnique({
    where: { id: groupId },
    select: { id: true, courseId: true, name: true },
  });

  if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Group not found." });
  await assertTeaches(ctx, found.courseId);
  return found;
}

/** A duplicate name is the one collision the database refuses; say so in words. */
function refuseDuplicate(err: unknown, name: string): never {
  const code = (err as { code?: string }).code;
  if (code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `This course already has a group called "${name}".`,
    });
  }
  throw err;
}

export const groupsRouter = createTRPCRouter({
  /**
   * Every group of a course, by name, with how many active students each holds.
   *
   * **The count is of active students only**, which is the same restriction every filtered read
   * applies. A removed student keeps their memberships — removal is a status rather than a
   * deleted row, so restoring somebody returns them to the groups they were in — but counting
   * them here would say a group holds fifteen while the pile it filters to holds fourteen, and
   * the two numbers are meant to be the same claim.
   *
   * Read by the picker on four screens, so it carries `gradingGroupId`: which group the caller
   * is currently working, so the picker opens on it rather than having to ask separately.
   */
  listForCourse: instructorProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);

      const [groups, instructorRow, ungrouped] = await Promise.all([
        ctx.db.courseGroup.findMany({
          where: { courseId: input.courseId },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            _count: { select: { memberships: { where: { enrollment: { status: "ACTIVE" } } } } },
          },
        }),
        /*
          Null for an admin, who has no `CourseInstructor` row in any course and therefore
          nowhere to remember a selection. That is the right answer rather than a gap: an admin
          reading somebody else's cohort is looking rather than working it, and the picker
          simply opens on All Students each time.
        */
        ctx.db.courseInstructor.findFirst({
          where: { courseId: input.courseId, userId: ctx.profile.id },
          select: { gradingGroupId: true },
        }),
        /*
          Active students in no group at all. Its own count rather than the cohort total minus
          the group counts, which would be wrong the moment a student is in two groups — a
          membership is many-to-many in both directions.
        */
        ctx.db.enrollment.count({
          where: {
            courseId: input.courseId,
            status: "ACTIVE",
            groupMemberships: { none: {} },
          },
        }),
      ]);

      return {
        groups: groups.map(({ _count, ...group }) => ({
          ...group,
          memberCount: _count.memberships,
        })),
        /** How many active students belong to no group, for the picker's Ungrouped entry. */
        ungroupedCount: ungrouped,
        /** The caller's remembered selection. Null is All Students. */
        gradingGroupId: instructorRow?.gradingGroupId ?? null,
      };
    }),

  /**
   * Every active student of a course with the groups each belongs to, for the roster.
   *
   * The management screen's read: one row per student, so an instructor sees who is in nothing
   * without having to compare two lists. Removed students are absent — they are not who
   * grouping is about, and the roster shows them in their own table anyway.
   */
  membershipsForCourse: instructorProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);

      const enrollments = await ctx.db.enrollment.findMany({
        where: { courseId: input.courseId, status: "ACTIVE" },
        select: {
          id: true,
          student: { select: { id: true, displayName: true, email: true, githubUsername: true } },
          groupMemberships: { select: { groupId: true } },
        },
      });

      return enrollments.map((enrollment) => ({
        enrollmentId: enrollment.id,
        student: enrollment.student,
        groupIds: enrollment.groupMemberships.map((membership) => membership.groupId),
      }));
    }),

  create: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), name: groupName }))
    .mutation(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);

      try {
        return await ctx.db.courseGroup.create({
          data: { courseId: input.courseId, name: input.name },
          select: { id: true, name: true },
        });
      } catch (err) {
        refuseDuplicate(err, input.name);
      }
    }),

  /**
   * Renames a group.
   *
   * Free, and the reason a group is a row with an id rather than a string on the enrollment:
   * every membership and every instructor filtered to it goes on pointing at the same row.
   */
  rename: instructorProcedure
    .input(z.object({ groupId: z.string().uuid(), name: groupName }))
    .mutation(async ({ ctx, input }) => {
      await loadTeachableGroup(ctx, input.groupId);

      try {
        return await ctx.db.courseGroup.update({
          where: { id: input.groupId },
          data: { name: input.name },
          select: { id: true, name: true },
        });
      } catch (err) {
        refuseDuplicate(err, input.name);
      }
    }),

  /**
   * Removes a group, however many students are in it.
   *
   * **Not refused on a non-empty group**, which is the opposite of `modules.remove` and is right
   * for the opposite reason. Removing a module would leave its assignments belonging to nothing;
   * removing a group destroys a set and touches no student, no submission, and no grade — the
   * memberships cascade and every student stays exactly where they were. The count comes back so
   * the confirmation can say what it dissolved.
   *
   * Any instructor filtered to it is returned to All Students by `onDelete: SetNull` rather than
   * being left holding an id that no longer resolves.
   */
  remove: instructorProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const found = await loadTeachableGroup(ctx, input.groupId);

      const memberCount = await ctx.db.groupMembership.count({
        where: { groupId: input.groupId },
      });

      await ctx.db.courseGroup.delete({ where: { id: input.groupId } });

      return { id: found.id, name: found.name, memberCount };
    }),

  /**
   * Sets a group's membership to exactly this list of students.
   *
   * The whole set rather than "add this one", for the same reason `modules.reorder` takes the
   * whole order: it is idempotent, it cannot leave a half-applied state, and one procedure
   * serves ticking a box today and a multi-select later. The alternative is add and remove as
   * separate mutations, where a screen that sent one and not the other leaves a membership
   * nobody intended.
   *
   * **Every id must be an active enrollment of this group's course**, checked rather than
   * trusted. The foreign key already refuses an enrollment that does not exist, but not one
   * belonging to a different cohort — and a group holding another course's student would be a
   * filter that quietly shows work from outside the cohort.
   */
  setMembers: instructorProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        enrollmentIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const group = await loadTeachableGroup(ctx, input.groupId);

      const wanted = [...new Set(input.enrollmentIds)];

      /*
        Active only. A removed student keeps the memberships they already had, but adding one is
        a different act — it would put somebody who has left into a pile that exists to say what
        is waiting on an instructor, and nothing would ever clear it.
      */
      const valid = await ctx.db.enrollment.findMany({
        where: { id: { in: wanted }, courseId: group.courseId, status: "ACTIVE" },
        select: { id: true },
      });

      if (valid.length !== wanted.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That list names somebody who is not an active student of this course. Reload the " +
            "page and try again — the roster may have changed since it was opened.",
        });
      }

      /*
        The difference is written, not the whole set — two statements and no transaction around
        them, for two reasons.

        Prisma refuses a nested interactive transaction, so a `$transaction` here would fail
        outright for any caller already inside one: every check script, and anything that later
        wants to group students as part of a larger write. Same constraint `modules.reorder`
        works around with a single statement.

        And writing the difference is what makes doing it without one safe. Delete-then-insert
        leaves an emptied group if the insert fails, which is the worst possible intermediate
        state for the only record of who somebody grades. Removing what was ticked off and adding
        what was ticked on leaves a coherent membership either way — some of the change applied,
        none of it invented — and the screen shows what actually happened when it refetches.
      */
      const existing = await ctx.db.groupMembership.findMany({
        where: { groupId: group.id, enrollment: { status: "ACTIVE" } },
        select: { enrollmentId: true },
      });

      const has = new Set(existing.map((membership) => membership.enrollmentId));
      const toAdd = wanted.filter((enrollmentId) => !has.has(enrollmentId));
      const toRemove = [...has].filter((enrollmentId) => !wanted.includes(enrollmentId));

      /*
        Scoped to the enrollments being taken off rather than to the group. A removed student's
        membership is deliberately untouched — they are not in `wanted` and could not be, so a
        blanket delete would quietly strip the groups they would return to when restored.
      */
      if (toRemove.length > 0) {
        await ctx.db.groupMembership.deleteMany({
          where: { groupId: group.id, enrollmentId: { in: toRemove } },
        });
      }

      if (toAdd.length > 0) {
        await ctx.db.groupMembership.createMany({
          data: toAdd.map((enrollmentId) => ({ groupId: group.id, enrollmentId })),
          skipDuplicates: true,
        });
      }

      return { groupId: group.id, memberCount: wanted.length };
    }),

  /**
   * Remembers which group the caller is working in this course.
   *
   * A filter and nothing more: it grants nothing, withholds nothing, and any instructor changes
   * their own at any moment. One value across every screen rather than one per screen, because
   * the fact it records is "I grade these fifteen" and not "on the gradebook I look at these
   * fifteen".
   *
   * **Null is All Students, and Ungrouped is not storable.** Ungrouped is a check — who has
   * nobody yet — rather than a way of working, so choosing it filters the screen in front of
   * you and leaves this alone. Making it storable would mean a sentinel in a foreign key column
   * to record a state nobody wants to return to.
   *
   * Silently does nothing for an admin, who has no `CourseInstructor` row to write to. That is
   * the honest outcome rather than an error: an admin can still filter any screen through the
   * query string, and inventing a row for them would put the cohort into their own course list
   * as one they teach.
   */
  setGradingGroup: instructorProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        groupId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);

      /*
        Checked rather than left to the foreign key, which would accept a group belonging to any
        course. Stored, that is a remembered filter matching no enrollment in this cohort — an
        empty screen on every visit, which reads as being caught up.
      */
      if (input.groupId) {
        const group = await ctx.db.courseGroup.findFirst({
          where: { id: input.groupId, courseId: input.courseId },
          select: { id: true },
        });

        if (!group) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That group does not belong to this course.",
          });
        }
      }

      const updated = await ctx.db.courseInstructor.updateMany({
        where: { courseId: input.courseId, userId: ctx.profile.id },
        data: { gradingGroupId: input.groupId },
      });

      return { groupId: input.groupId, remembered: updated.count > 0 };
    }),
});
