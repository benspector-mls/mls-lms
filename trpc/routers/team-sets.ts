import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { teachableTeam, teachableTeamSet } from "@/lib/courses/scope";

import { courseProcedure, createTRPCRouter, instructorProcedure } from "../init";
import { personSelect } from "../selects";

/**
 * The team sets of a course: create one with its teams, rename them, and place fellows on them.
 *
 * A team set is a named, reusable collection of the teams a course's students work in. It is the
 * second way of dividing a cohort and deliberately not the first: `CourseGroup` — "Groups" on the
 * roster — splits the marking between co-teachers, is invisible to students, and decides nothing
 * about the work. A team hands in one piece of work, receives one grade, and its members can see
 * each other. Nothing in `groups.ts` changed to make room for this.
 *
 * **A set partitions the cohort.** A fellow is on at most one team of any one set, which is what
 * gives "which team are you on for this project" a single answer, and it is the database that
 * says so rather than a rule here. They may be on a team in every other set, which is what makes
 * a set reusable: one for each project, each dividing the same cohort differently.
 *
 * **Instructor-only.** There is no procedure here a student can call. What a student may see of
 * their own team is read through their own assignment, in `assignments.ts`, from their own
 * membership — never from a team id they could pass in.
 *
 * Every write is `instructorProcedure` *and* a `teachable*` loader, exactly as the groups router
 * is: the role alone would let one cohort's instructor regroup another's students.
 */

/** Trimmed, because " Team 1" and "Team 1" are the same team to everyone but the database. */
const teamSetName = z.string().trim().min(1, "A team set needs a name.").max(120);
const teamName = z.string().trim().min(1, "A team needs a name.").max(120);

/**
 * How many teams a new set is created with.
 *
 * One is allowed: a class of four doing one project together is a set of one team, and refusing
 * it would send an instructor looking for a different feature. The ceiling is a guard against a
 * typo in a number field, not a considered maximum.
 */
const teamCount = z.number().int().min(1, "A set needs at least one team.").max(60);

/** A duplicate name is the one collision the database refuses; say so in words. */
function refuseDuplicate(err: unknown, name: string, what: "team set" | "team"): never {
  const code = (err as { code?: string }).code;
  if (code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        what === "team set"
          ? `This course already has a team set called "${name}".`
          : `This set already has a team called "${name}".`,
    });
  }
  throw err;
}

export const teamSetsRouter = createTRPCRouter({
  /**
   * Every team set of a course, with its teams and who is on them.
   *
   * One read for the whole roster card rather than one per set. A cohort has a handful of sets
   * holding a handful of teams each, so the whole shape is small — and the alternative is a
   * collapsible row that fetches when it opens, which is a spinner on every click for data that
   * was already worth having.
   *
   * **Active students only**, which is the same restriction every other count in this application
   * applies. A removed fellow keeps their place on a team — removal is a status rather than a
   * deleted row, so restoring somebody returns them to it — but counting them would say a team
   * holds four while the work it hands in belongs to three.
   */
  listForCourse: courseProcedure.query(async ({ ctx, input }) => {
    const [sets, unplacedCount] = await Promise.all([
      ctx.db.teamSet.findMany({
        where: { courseId: input.courseId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          teams: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              name: true,
              position: true,
              memberships: {
                where: { enrollment: { status: "ACTIVE" } },
                select: {
                  enrollmentId: true,
                  enrollment: { select: { student: { select: personSelect } } },
                },
              },
            },
          },
          /*
            How many assignments hand in through this set. Shown so that removing a set can say
            what it would take with it, and so that an instructor can tell last term's set from
            the one in use without opening either.
          */
          _count: { select: { assignments: true } },
        },
      }),
      ctx.db.enrollment.count({ where: { courseId: input.courseId, status: "ACTIVE" } }),
    ]);

    return {
      sets: sets.map((set) => {
        const teams = set.teams.map((team) => ({
          id: team.id,
          name: team.name,
          position: team.position,
          members: team.memberships.map((membership) => ({
            enrollmentId: membership.enrollmentId,
            student: membership.enrollment.student,
          })),
        }));

        const placed = teams.reduce((total, team) => total + team.members.length, 0);

        return {
          id: set.id,
          name: set.name,
          teams,
          /** Placed and unplaced, so the collapsed row can say "21 of 24 fellows placed". */
          placedCount: placed,
          unplacedCount: Math.max(0, unplacedCount - placed),
          assignmentCount: set._count.assignments,
        };
      }),
      /** Every active fellow in the cohort, which is the denominator each set is measured against. */
      activeCount: unplacedCount,
    };
  }),

  /**
   * Creates a set and the teams in it, in one act.
   *
   * **The count is asked for here rather than teams being added one at a time**, because a set
   * exists to divide a cohort and a set with no teams divides nothing — it is a half-made thing
   * that every screen would then have to describe. Asking how many produces something usable
   * immediately, and `addTeam` below covers the case that turns up later.
   *
   * The teams are named "Team 1" through "Team N" and are renameable. Positions are what they are
   * ordered by, so "Team 4" does not sort after "Team 12" the way a list ordered by name would.
   */
  create: courseProcedure
    .input(z.object({ name: teamSetName, teamCount }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.teamSet.create({
          data: {
            courseId: input.courseId,
            name: input.name,
            teams: {
              create: Array.from({ length: input.teamCount }, (_, index) => ({
                courseId: input.courseId,
                name: `Team ${index + 1}`,
                position: index,
              })),
            },
          },
          select: { id: true, name: true, _count: { select: { teams: true } } },
        });
      } catch (err) {
        refuseDuplicate(err, input.name, "team set");
      }
    }),

  rename: instructorProcedure
    .input(z.object({ teamSetId: z.string().uuid(), name: teamSetName }))
    .mutation(async ({ ctx, input }) => {
      await teachableTeamSet(ctx, input.teamSetId, { id: true });

      try {
        return await ctx.db.teamSet.update({
          where: { id: input.teamSetId },
          data: { name: input.name },
          select: { id: true, name: true },
        });
      } catch (err) {
        refuseDuplicate(err, input.name, "team set");
      }
    }),

  /**
   * Removes a set, its teams, and every placement in it.
   *
   * **Refused while an assignment hands in through it**, which is the opposite of
   * `groups.remove` and right for the opposite reason. Removing a group destroys a filter and
   * touches no student, no submission and no grade. Removing a set that work was handed in
   * through would leave submissions naming teams that no longer exist — and those submissions
   * carry released grades. `Assignment.teamSet` is `Restrict`, so the database refuses it too;
   * this is what turns that refusal into a sentence naming the assignments in the way.
   */
  remove: instructorProcedure
    .input(z.object({ teamSetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const found = await teachableTeamSet(ctx, input.teamSetId, {
        id: true,
        name: true,
        assignments: { select: { title: true }, orderBy: { title: "asc" } },
        _count: { select: { teams: true } },
      });

      if (found.assignments.length > 0) {
        const titles = found.assignments.map((assignment) => `"${assignment.title}"`).join(", ");
        throw new TRPCError({
          code: "CONFLICT",
          message:
            `${titles} ${found.assignments.length === 1 ? "is handed in" : "are handed in"} ` +
            `through "${found.name}", so removing it would leave work belonging to teams that ` +
            `no longer exist. Point those assignments at a different set first.`,
        });
      }

      const memberCount = await ctx.db.teamMembership.count({
        where: { teamSetId: input.teamSetId },
      });

      await ctx.db.teamSet.delete({ where: { id: input.teamSetId } });

      return { id: found.id, name: found.name, teamCount: found._count.teams, memberCount };
    }),

  /** One more team, at the end. For the case that turns up after a set is made. */
  addTeam: instructorProcedure
    .input(z.object({ teamSetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const set = await teachableTeamSet(ctx, input.teamSetId, { id: true, courseId: true });

      /*
        Named and positioned from the highest position rather than from the count, so a set whose
        third team was removed gets a "Team 4" rather than a second "Team 3".
      */
      const last = await ctx.db.team.findFirst({
        where: { teamSetId: set.id },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const position = (last?.position ?? -1) + 1;

      try {
        return await ctx.db.team.create({
          data: {
            teamSetId: set.id,
            courseId: set.courseId,
            name: `Team ${position + 1}`,
            position,
          },
          select: { id: true, name: true, position: true },
        });
      } catch (err) {
        refuseDuplicate(err, `Team ${position + 1}`, "team");
      }
    }),

  renameTeam: instructorProcedure
    .input(z.object({ teamId: z.string().uuid(), name: teamName }))
    .mutation(async ({ ctx, input }) => {
      await teachableTeam(ctx, input.teamId, { id: true });

      try {
        return await ctx.db.team.update({
          where: { id: input.teamId },
          data: { name: input.name },
          select: { id: true, name: true },
        });
      } catch (err) {
        refuseDuplicate(err, input.name, "team");
      }
    }),

  /**
   * Removes one team from a set, and with it the placements of whoever was on it.
   *
   * **Refused once the team has handed anything in.** Its submissions name it, and one of them
   * may hold a released grade; `Submission.team` is `Restrict`, so the database refuses this as
   * well. Positions are deliberately left with a gap rather than renumbered — an instructor
   * renames teams, and renumbering would silently make somebody else's "Team 5" mean a different
   * set of people.
   */
  removeTeam: instructorProcedure
    .input(z.object({ teamId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const team = await teachableTeam(ctx, input.teamId, {
        id: true,
        name: true,
        _count: { select: { memberships: true, submissions: true } },
      });

      if (team._count.submissions > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            `"${team.name}" has already handed work in, so it cannot be removed — its ` +
            `submissions name it, and one of them may carry a grade that has gone out. Move its ` +
            `members to another team instead.`,
        });
      }

      await ctx.db.team.delete({ where: { id: team.id } });

      return { id: team.id, name: team.name, memberCount: team._count.memberships };
    }),

  /**
   * Places fellows on the teams of one set: the whole placement, not one change.
   *
   * The whole set rather than "move this one", for the reason `groups.setMembers` takes the whole
   * list and `courseUnits.reorder` takes the whole order: it is idempotent, it cannot leave a
   * half-applied state, and one procedure serves a select changed once and a "distribute evenly"
   * button that changes everything.
   *
   * A `teamId` of null takes a fellow off the team they are on and leaves them unplaced, which is
   * how somebody is removed without needing a second mutation.
   *
   * **Every enrollment must be an active one of this set's own course, and every team must belong
   * to this set**, both checked rather than trusted. The foreign keys already refuse a team from
   * another set and a student from another cohort — that is what the composite keys are for — but
   * a refusal arriving as a constraint error is one an instructor cannot act on.
   */
  setPlacements: instructorProcedure
    .input(
      z.object({
        teamSetId: z.string().uuid(),
        placements: z.array(
          z.object({
            enrollmentId: z.string().uuid(),
            /** Null leaves the fellow on no team of this set. */
            teamId: z.string().uuid().nullable(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const set = await teachableTeamSet(ctx, input.teamSetId, { id: true, courseId: true });

      /*
        Last wins, rather than refusing a repeated enrollment. Two entries for one fellow is a
        screen that sent its state twice, not an instruction to put somebody on two teams — and
        the database would refuse the second anyway, having been told a set is a partition.
      */
      const wanted = new Map(
        input.placements.map((placement) => [placement.enrollmentId, placement.teamId]),
      );

      const [validEnrollments, validTeams] = await Promise.all([
        ctx.db.enrollment.findMany({
          // Active only. Placing somebody who has left the cohort onto a team would put them in
          // line for work they will not hand in, and nothing would ever clear it.
          where: { id: { in: [...wanted.keys()] }, courseId: set.courseId, status: "ACTIVE" },
          select: { id: true },
        }),
        ctx.db.team.findMany({
          where: { teamSetId: set.id },
          select: { id: true },
        }),
      ]);

      if (validEnrollments.length !== wanted.size) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That list names somebody who is not an active student of this course. Reload the " +
            "page and try again — the roster may have changed since it was opened.",
        });
      }

      const teamIds = new Set(validTeams.map((team) => team.id));
      for (const teamId of wanted.values()) {
        if (teamId !== null && !teamIds.has(teamId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "That list names a team that does not belong to this set. Reload the page and try " +
              "again — the set may have changed since it was opened.",
          });
        }
      }

      /*
        The difference is written, not the whole set, and with no transaction around it — for the
        two reasons `groups.setMembers` gives. Prisma refuses a nested interactive transaction, so
        a `$transaction` here would fail outright for any caller already inside one, which is
        every check script. And writing the difference is what makes doing it without one safe:
        delete-then-insert leaves a set with nobody on any team if the insert fails, which is the
        worst intermediate state for the only record of who hands in together.
      */
      const existing = await ctx.db.teamMembership.findMany({
        where: { teamSetId: set.id, enrollmentId: { in: [...wanted.keys()] } },
        select: { id: true, enrollmentId: true, teamId: true },
      });

      const currentTeam = new Map(existing.map((row) => [row.enrollmentId, row.teamId]));

      const toRemove = existing
        .filter((row) => wanted.get(row.enrollmentId) !== row.teamId)
        .map((row) => row.id);

      const toAdd = [...wanted.entries()].filter(
        ([enrollmentId, teamId]) => teamId !== null && currentTeam.get(enrollmentId) !== teamId,
      );

      /*
        Removed before added, which matters here in a way it does not for groups: a set is a
        partition, so moving somebody from one team to another would collide with their own
        existing row if the insert went first.
      */
      if (toRemove.length > 0) {
        await ctx.db.teamMembership.deleteMany({ where: { id: { in: toRemove } } });
      }

      if (toAdd.length > 0) {
        await ctx.db.teamMembership.createMany({
          data: toAdd.map(([enrollmentId, teamId]) => ({
            teamId: teamId as string,
            teamSetId: set.id,
            courseId: set.courseId,
            enrollmentId,
          })),
          skipDuplicates: true,
        });
      }

      return { teamSetId: set.id, moved: toAdd.length, unplaced: toRemove.length - toAdd.length };
    }),
});
