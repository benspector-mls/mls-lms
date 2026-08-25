import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { inTransaction } from "@/lib/prisma";

import { auditActor, recordEvent } from "@/lib/audit/record";
import { arrivalAverages } from "@/lib/attendance/arrival";
import { summarize } from "@/lib/attendance/summary";
import { sessionStateOf } from "@/lib/attendance/window";
import { newJoinToken } from "@/lib/courses/join-token";
import { allUnits, courseVerdictByStudent, groupByUnit } from "@/lib/gradebook/categories";
import { assertOwnsProgram, ownerOf } from "@/lib/programs/ownership";
import { schoolDayFromColumn, schoolDayOf } from "@/lib/school-time";
import { removeSubmissionUploads } from "@/lib/uploads/storage";

import {
  type AuthedCtx,
  createTRPCRouter,
  instructorProcedure,
  profileProcedure,
  programProcedure,
} from "../init";
import { displayNameOf, personNameSelect, personSelect } from "../selects";

/**
 * A program: the matriculation a fellow is admitted to, and everything it owns above the course.
 *
 * The roster, the attendance days, the cohorts, and the instructors all belong here. What a course
 * still owns is the work — its units, its assignments, its gradebook, and its team sets — and
 * `courses.ts` is where that lives.
 *
 * **Authority is granted here and only here.** An instructor of a program may author, grade, and
 * approve in every course of it; a `CourseInstructor` row records who is actually working a course
 * and grants nothing. See `assertTeaches` in lib/courses/membership.ts for why that is the decision
 * and `ownerOf` in lib/programs/ownership.ts for what the owner can do that the rest cannot.
 */

/**
 * Everything one attendance session's state is decided from.
 *
 * The same columns `attendance.ts` selects, minus the secret — `sessionStateOf` needs the two ending
 * columns and the backstop, and nothing here derives a code. Repeated rather than imported so this
 * router does not depend on that one's internals for a read of its own.
 */
const attendanceSessionSelect = {
  id: true,
  date: true,
  startedAt: true,
  endsAt: true,
  endedAt: true,
  lateAfterMinutes: true,
} as const;

const programName = z.string().trim().min(1, "A program needs a name.").max(200);
const matriculation = z.string().trim().min(1, "A program needs a matriculation.").max(120);

export const programsRouter = createTRPCRouter({
  /**
   * Programs the caller belongs to, either enrolled as a fellow or listed as an instructor. Admins
   * see every one.
   *
   * **Archived matriculations are returned, labelled, rather than filtered out**, for the reason
   * `courses.listMine` returns archived courses: every procedure still admits their members, so
   * filtering here would leave a program reachable only by a URL somebody happened to keep.
   * Archiving takes something off the active list; it does not lose it.
   */
  listMine: profileProcedure.query(async ({ ctx }) => {
    const isAdmin = ctx.profile.role === "ADMIN";

    const programs = await ctx.db.program.findMany({
      where: isAdmin
        ? {}
        : {
            OR: [
              { enrollments: { some: { studentId: ctx.profile.id } } },
              { instructors: { some: { userId: ctx.profile.id } } },
            ],
          },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        matriculation: true,
        archivedAt: true,
        /*
          ACTIVE only, and test students excluded. This figure is the one somebody quotes — a
          roster of 25 must not read as 26 because an admin previewed a course — and a fellow who
          has left is not the answer to "how many fellows does this matriculation have".

          The course count is every course, published or not, because the reader is an instructor
          list. A fellow's own sidebar is built from `courses.listMine`, which applies publication.
        */
        _count: {
          select: {
            courses: true,
            enrollments: { where: { status: "ACTIVE", student: { testStudentNumber: null } } },
          },
        },
        // The caller's own enrollment, so a card can say they have left this one.
        enrollments: {
          where: { studentId: ctx.profile.id },
          select: { status: true },
          take: 1,
        },
        // Whether the caller instructs this program, which is not the same as their role: an admin
        // instructs none of them and sees all.
        instructors: {
          where: { userId: ctx.profile.id },
          select: { id: true },
          take: 1,
        },
      },
    });

    return programs.map(({ instructors, enrollments, ...program }) => ({
      ...program,
      instructs: isAdmin || instructors.length > 0,
      /** Null when the caller is not a fellow of this program — an instructor, or an admin. */
      enrolledAs: enrollments[0]?.status ?? null,
    }));
  }),

  /**
   * One program the caller belongs to, with its courses.
   *
   * What the breadcrumb, the sidebar's program group, and the course switcher read. **A fellow sees
   * only the published courses**, which is the second of the three readers that have to agree about
   * `Course.publishedAt` — the others are `assertCourseMember` and `distributedToStudent`.
   */
  get: profileProcedure
    .input(z.object({ programId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const isAdmin = ctx.profile.role === "ADMIN";

      const instructs =
        isAdmin ||
        (await ctx.db.programInstructor.findFirst({
          where: { programId: input.programId, userId: ctx.profile.id },
          select: { id: true },
        })) !== null;

      const program = await ctx.db.program.findUnique({
        where: { id: input.programId },
        select: {
          id: true,
          name: true,
          matriculation: true,
          archivedAt: true,
          courses: {
            // Instructors author unpublished courses; fellows must not see them at all.
            where: instructs ? {} : { publishedAt: { not: null } },
            orderBy: [{ createdAt: "asc" }],
            select: {
              id: true,
              name: true,
              slug: true,
              publishedAt: true,
              archivedAt: true,
            },
          },
        },
      });

      if (!program) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Program not found." });
      }

      if (!instructs) {
        // Every status, not just ACTIVE: a removed fellow keeps reading the program and the
        // feedback they were given. Refusing them here is what would take it back.
        const enrollment = await ctx.db.enrollment.findFirst({
          where: { programId: program.id, studentId: ctx.profile.id },
          select: { id: true },
        });

        if (!enrollment) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this program.",
          });
        }
      }

      return { ...program, instructs };
    }),

  /**
   * The roster: everybody who has ever joined this program, and the link that lets them.
   *
   * **Every status, and deliberately not filtered here.** A removed fellow has to appear — they are
   * who Restore acts on, and a roster that silently omitted them would make removal look like
   * deletion. The screen splits them into their own table.
   *
   * Carries each fellow's cohort, because the roster is where cohorts are managed.
   */
  roster: programProcedure.query(async ({ ctx, input }) => {
    const program = await ctx.db.program.findUnique({
      where: { id: input.programId },
      select: {
        id: true,
        name: true,
        matriculation: true,
        archivedAt: true,
        /*
          The join link. Safe here and nowhere a fellow can reach: this procedure is
          `programProcedure`, so it is instructor-only and gated on this program. It must never
          appear in `get` or in any course payload — a link in a payload is a link that has leaked.
        */
        joinToken: true,
      },
    });

    if (!program) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Program not found." });
    }

    const enrollments = await ctx.db.enrollment.findMany({
      where: { programId: program.id },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        status: true,
        cohortId: true,
        student: { select: personSelect },
      },
    });

    return { program, enrollments };
  }),

  /**
   * One fellow, across the whole matriculation.
   *
   * **About the person rather than about their work**, which is what makes it a different read from
   * `submissions.listForStudent`. That one is a fellow's submissions in one course, opened from the
   * gradebook to grade them; this is who they are, when they arrive in the mornings, which cohort
   * they are in, and where they stand in each course of the year. Splitting them is what lets grading
   * stay per course while the roster lives above every course.
   *
   * **The arrival averages are computed here from this fellow's records alone.** `attendance.history`
   * computes the same figures for the whole roster, and reusing it for one person would fetch a
   * year's records for twenty-five people to report on one — the shared thing is `arrivalAverages`
   * itself, so the two screens cannot disagree about what a mean means.
   *
   * **A verdict per course rather than a submission list.** The row is a way in: what belongs on this
   * screen is "they have finished the prework and are half through the fellowship", and the work
   * itself is one click away at `studentHref`. `courseVerdictByStudent` is the same function the
   * gradebook's Overview column reads, so a fellow and their instructor cannot be shown different
   * answers.
   */
  student: programProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();

      const enrollment = await ctx.db.enrollment.findUnique({
        where: {
          programId_studentId: { programId: input.programId, studentId: input.studentId },
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          cohort: { select: { id: true, name: true } },
          student: { select: personSelect },
          program: {
            select: {
              id: true,
              name: true,
              matriculation: true,
              archivedAt: true,
              /*
                Every course, published or not: the reader is an instructor, and a course they are
                still writing is one this fellow is already a student of. The screen says which are
                which so a missing verdict is not read as missing work.
              */
              courses: {
                orderBy: [{ createdAt: "asc" }],
                select: { id: true, name: true, publishedAt: true, archivedAt: true },
              },
            },
          },
        },
      });

      if (!enrollment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That person is not on this program's roster.",
        });
      }

      const courseIds = enrollment.program.courses.map((course) => course.id);

      const [sessions, records, units, cells, gcf] = await Promise.all([
        ctx.db.attendanceSession.findMany({
          where: { programId: input.programId },
          orderBy: { date: "asc" },
          select: attendanceSessionSelect,
        }),
        ctx.db.attendanceRecord.findMany({
          where: { enrollmentId: enrollment.id },
          select: { sessionId: true, status: true, checkedInAt: true },
        }),
        courseIds.length === 0
          ? []
          : ctx.db.courseUnit.findMany({
              where: { courseId: { in: courseIds } },
              select: {
                id: true,
                courseId: true,
                name: true,
                position: true,
                category: true,
                assignments: {
                  select: {
                    id: true,
                    title: true,
                    dueAt: true,
                    courseUnitId: true,
                    distributedAt: true,
                  },
                },
              },
            }),
        courseIds.length === 0
          ? []
          : ctx.db.submission.findMany({
              where: {
                studentId: input.studentId,
                assignment: { courseId: { in: courseIds } },
              },
              select: { assignmentId: true, studentId: true, isComplete: true },
            }),
        /*
          Their whole GCF history, and it names no matriculation. A result is sat at CodeSignal on a
          fellow's own schedule and carries no program, so somebody who repeats a year has one history
          rather than two halves of it — see `gcfHref` for the same decision about the address.
        */
        ctx.db.gcfAttempt.findMany({
          where: { studentId: input.studentId },
          orderBy: { takenOn: "desc" },
          select: {
            id: true,
            kind: true,
            score: true,
            scorePossible: true,
            takenOn: true,
            integrityFlagged: true,
          },
        }),
      ]);

      const summarySessions = sessions.map((session) => ({
        id: session.id,
        day: schoolDayFromColumn(session.date),
        open: sessionStateOf(session, now) === "open",
      }));

      const enrolledFrom = schoolDayOf(enrollment.createdAt);

      const [summary] = summarize(
        summarySessions,
        [
          {
            enrollmentId: enrollment.id,
            studentId: enrollment.student.id,
            displayName: enrollment.student.displayName,
            email: enrollment.student.email,
            githubUsername: enrollment.student.githubUsername,
            testStudentNumber: enrollment.student.testStudentNumber,
            enrolledFrom,
          },
        ],
        records.map((record) => ({
          enrollmentId: enrollment.id,
          sessionId: record.sessionId,
          status: record.status,
        })),
      );

      /*
        Only records carrying a `checkedInAt`, and the weekday taken from the session's day rather
        than from the arrival instant. Both rules live in `lib/attendance/arrival.ts`; this supplies
        the pairs, exactly as `attendance.history` does.
      */
      const dayBySession = new Map(summarySessions.map((session) => [session.id, session.day]));
      const arrivals = arrivalAverages(
        records.flatMap((record) => {
          const day = record.checkedInAt ? dayBySession.get(record.sessionId) : undefined;
          return day ? [{ day, checkedInAt: record.checkedInAt! }] : [];
        }),
      );

      const courses = enrollment.program.courses.map((course) => {
        const own = units.filter((unit) => unit.courseId === course.id);
        const grouped = groupByUnit(
          own.flatMap((unit) => unit.assignments),
          own,
        );

        return {
          ...course,
          /** Where they stand on the whole course, by the rule the gradebook's Overview applies. */
          completion:
            courseVerdictByStudent(cells, allUnits(grouped), [input.studentId]).get(
              input.studentId,
            ) ?? "pending",
        };
      });

      return {
        program: enrollment.program,
        student: enrollment.student,
        enrollmentId: enrollment.id,
        enrollmentStatus: enrollment.status,
        enrolledFrom,
        /** Null when nobody has placed them, which is a fact the screen states in words. */
        cohort: enrollment.cohort,
        summary,
        arrivals,
        courses,
        gcf,
      };
    }),

  /**
   * The matriculation itself: what it is called, its two links, who instructs it, and which of them
   * teaches which course.
   *
   * **Both tokens are returned here and nowhere else.** `programProcedure` is what makes that safe:
   * instructor-only and gated on this program. The instructor link is the sharper of the two — it
   * admits somebody to every fellow's grades in every course — so it appears in no other payload.
   */
  settings: programProcedure.query(async ({ ctx, input }) => {
    const program = await ctx.db.program.findUnique({
      where: { id: input.programId },
      select: {
        id: true,
        name: true,
        matriculation: true,
        archivedAt: true,
        createdAt: true,
        attendanceLateAfterMinutes: true,
        joinToken: true,
        instructorToken: true,
        instructors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: {
            id: true,
            isPrimary: true,
            createdAt: true,
            user: { select: personSelect },
            teaches: { select: { courseId: true } },
          },
        },
        courses: {
          orderBy: [{ createdAt: "asc" }],
          select: { id: true, name: true, slug: true, publishedAt: true, archivedAt: true },
        },
      },
    });

    if (!program) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Program not found." });
    }

    /*
      Derived by the same function the guards use, rather than read off `isPrimary` here.

      The owner is `isPrimary` **or** the longest-serving instructor when no row holds it, and a
      screen that knew only the first half would show a program with no owner and offer an Archive
      button that the procedure then refuses. Null only for a program with no instructors at all,
      which `removeInstructor` refuses to create.
    */
    const ownerId =
      ownerOf(program.instructors.map((row) => ({ ...row, userId: row.user.id })))?.userId ?? null;

    return {
      program,
      /** Which of the instructors is the caller, so the screen never offers to remove them by surprise. */
      callerId: ctx.profile.id,
      /** Which of them owns it. */
      ownerId,
      /**
       * Whether this caller may do the things ownership gates — archive, delete, hand the program
       * on, decide who teaches what, remove another instructor.
       *
       * Not `ownerId === callerId` in the browser, because an admin acts as owner on every program
       * and holds no `ProgramInstructor` row on any of them. A screen deriving it that way would
       * hide the Archive button from the one reader who is the recovery path when an owner has left.
       */
      callerActsAsOwner: ownerId === ctx.profile.id || ctx.profile.role === "ADMIN",
    };
  }),

  // =====================================================================================
  // Creating and retiring a matriculation
  // =====================================================================================

  /**
   * Creates a program, empty.
   *
   * **The creator becomes the primary instructor in the same transaction**, and that is not a
   * convenience: every authoring procedure checks `ProgramInstructor` rather than the role, so a
   * program whose row was not written is one its own creator cannot add a course to — and it looks
   * entirely normal until they try.
   *
   * **No courses are copied.** Carrying a term forward is `courses.create` copying a previous
   * course, once per course; a program-level copy is a small addition on top of that and needs no
   * schema change, so it is deliberately not here yet.
   */
  create: instructorProcedure
    .input(z.object({ name: programName, matriculation }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.program.create({
          data: {
            name: input.name,
            matriculation: input.matriculation,
            joinToken: newJoinToken(),
            instructorToken: newJoinToken(),
            instructors: { create: { userId: ctx.profile.id, isPrimary: true } },
          },
          select: { id: true, name: true, matriculation: true },
        });
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              `There is already a "${input.name}" starting "${input.matriculation}". A program ` +
              `runs every term under the same name, so the matriculation is what tells two of ` +
              `them apart — check whether the one you want already exists.`,
          });
        }
        throw err;
      }
    }),

  /**
   * Retires a matriculation, or brings it back.
   *
   * The program leaves every active list and stays readable to the people who were in it; nothing
   * new can be submitted in any of its courses. Reversible on purpose — a tidying action that cannot
   * be undone gets avoided rather than used.
   *
   * **Owner only, in both directions.** This is the one action a single instructor takes that changes
   * what every fellow on the roster sees. Reopening is the same gate because it is the same mutation
   * with a boolean, and the consequence is worth knowing rather than discovering: a co-teacher finds
   * an archived program in their list, reads all of it, and cannot bring it back.
   */
  setArchived: instructorProcedure
    .input(z.object({ programId: z.string().uuid(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsProgram(ctx, input.programId, input.archived ? "archive" : "reopen");

      return ctx.db.program.update({
        where: { id: input.programId },
        data: { archivedAt: input.archived ? new Date() : null },
        select: { id: true, name: true, archivedAt: true },
      });
    }),

  /**
   * How long after check-in opens a fellow still counts as on time.
   *
   * The program's own norm rather than an application-wide constant, because it is one: a program
   * that starts with fifteen minutes of standup and one that starts with a quiz disagree about when
   * the door closes, and neither is wrong. One value now rather than one per course, because there
   * is one morning.
   *
   * **It applies to sessions started from now on and rewrites nothing.** Each session copies this
   * number when it starts, so a term of recorded lateness cannot be changed by moving a setting —
   * see the comment on `AttendanceSession.lateAfterMinutes`. Correcting one morning that was
   * recorded wrongly is `attendance.updateSession`, which is a different act and says so.
   *
   * Instructor-gated rather than owner-only, unlike archiving. It changes what a future session
   * records, not what any fellow can already see.
   */
  setAttendanceLateAfter: programProcedure
    .input(z.object({ minutes: z.number().int().min(0).max(120) }))
    .mutation(async ({ ctx, input }) =>
      ctx.db.program.update({
        where: { id: input.programId },
        data: { attendanceLateAfterMinutes: input.minutes },
        select: { id: true, attendanceLateAfterMinutes: true },
      }),
    ),

  /**
   * Replaces the join link, invalidating the old one.
   *
   * **The only control over who can use it.** Anyone holding the link and named on the roster joins
   * immediately, so a link that reached the wrong person is dealt with by replacing it and removing
   * whoever got in. Fellows already enrolled are unaffected — the token is how you *join*, not how
   * you stay.
   */
  regenerateJoinToken: programProcedure.mutation(async ({ ctx, input }) => {
    return inTransaction(ctx.db, async (tx) => {
      const program = await tx.program.update({
        where: { id: input.programId },
        data: { joinToken: newJoinToken() },
        select: { id: true, name: true, joinToken: true },
      });

      /*
        Worth recording because rotating the link is what an instructor does *after* something has
        gone wrong — a link forwarded to the wrong person, a link posted somewhere public. The event
        is the timestamp that says when the old one stopped working, which is the question asked when
        working out how somebody got onto a roster.

        The token itself is not recorded, new or old, for the reason `createInvite` does not record
        one: it is the whole credential.
      */
      await recordEvent(tx, {
        action: "JOIN_TOKEN_REGENERATED",
        actor: auditActor(ctx),
        program: { id: program.id, label: program.name },
      });

      return { id: program.id, joinToken: program.joinToken };
    });
  }),

  // =====================================================================================
  // Instructors: who may teach in this matriculation, and who teaches what
  //
  // A second link, deliberately not the join link, because the two grant opposite things. The join
  // link admits a stranger to the roster as a fellow; this one admits them to authoring, to the
  // gradebook, and to every fellow's grade in every course of the program.
  //
  // **It grants a program, never a role.** Only an account that already holds INSTRUCTOR or ADMIN
  // can redeem it. A fellow opening it is refused and told what is actually needed, rather than
  // promoted — a link that made somebody staff would be a second path to staff access with no admin
  // involved, which is exactly what `adminProcedure` and `InstructorInvite` exist to control.
  //
  // Reusable rather than single use, unlike an instructor invitation. A program gains co-teachers one
  // at a time across a term and the sender is the same person either way; what bounds this link is
  // the role check rather than the token being spent, and `regenerateInstructorToken` is the control
  // over a link that reached the wrong person.
  // =====================================================================================

  /**
   * What an instructor link points at, before anybody redeems it.
   *
   * `profileProcedure`, because the caller is by definition not yet an instructor of this program —
   * that is what they are here to change. Returns null on an unknown token so a replaced link reads
   * as "this link no longer works" rather than as an error page.
   *
   * It reports `eligible` rather than refusing, so the screen can explain the one refusal that has
   * an answer: a fellow's account cannot be made staff from here, and saying so on arrival beats a
   * failed button.
   *
   * The select is deliberately narrow — a name and a display name, no email addresses — because a
   * stranger holding a link should not be handed a way to read who runs the program.
   */
  previewInstructorLink: profileProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const program = await ctx.db.program.findUnique({
        where: { instructorToken: input.token },
        select: {
          id: true,
          name: true,
          matriculation: true,
          archivedAt: true,
          instructors: {
            where: { isPrimary: true },
            take: 1,
            select: { user: { select: { displayName: true } } },
          },
        },
      });

      if (!program) return null;

      const already = await ctx.db.programInstructor.findUnique({
        where: { programId_userId: { programId: program.id, userId: ctx.profile.id } },
        select: { id: true },
      });

      return {
        programId: program.id,
        name: program.name,
        matriculation: program.matriculation,
        archived: program.archivedAt !== null,
        owner: program.instructors[0]?.user.displayName ?? null,
        /** Whether this account may hold the grant at all — staff only. */
        eligible: ctx.profile.role === "INSTRUCTOR" || ctx.profile.role === "ADMIN",
        /** So the screen says "you already instruct this" rather than offering to join again. */
        alreadyInstructs: already !== null,
      };
    }),

  /**
   * Redeems an instructor link, adding the caller to the program as an instructor.
   *
   * **Idempotent**, the same way `enrollments.join` is and for the same reason:
   * `@@unique([programId, userId])` means a second redemption returns the row that exists rather
   * than adding another, so a bookmarked link is not a case to handle.
   *
   * `isPrimary: false`, always. The owner is whoever created the matriculation, and that is a fact
   * about how it came to exist rather than a rank a link can confer.
   *
   * **It adds them to the program and to no course.** Which courses somebody teaches is the owner's
   * decision on the program's settings screen — see `setCourseInstructors` — and it grants nothing
   * anyway, so guessing here would only put a name on a course nobody put it on.
   */
  acceptInstructorLink: profileProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const program = await ctx.db.program.findUnique({
        where: { instructorToken: input.token },
        select: { id: true, name: true, archivedAt: true },
      });

      /*
        The same message whether the link was never real or has been replaced. From here they are
        the same fact, and telling them apart would say something about a program the caller has no
        connection to.
      */
      if (!program) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "That instructor link does not work. It may have been replaced — ask whoever sent " +
            "it for the current one.",
        });
      }

      /*
        A fellow is refused rather than promoted, and told what would actually help.

        This is the guard the whole design rests on. Raising a role here would mean any instructor
        could hand out staff access to anybody by forwarding a link, with no admin involved and no
        record of it beyond a `ProgramInstructor` row.
      */
      if (ctx.profile.role !== "INSTRUCTOR" && ctx.profile.role !== "ADMIN") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            `This link adds an instructor to ${program.name}, and your account is not an ` +
            `instructor account. An admin has to send you an instructor invitation first — once ` +
            `you have used that, this link will work.`,
        });
      }

      if (program.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${program.name} is archived, so it is not taking new instructors.`,
        });
      }

      /*
        An enrolled fellow of this program is refused, the mirror of `enrollments.join` refusing an
        instructor. Being both would put their own submissions in the queue they are meant to be
        working through.
      */
      const enrolled = await ctx.db.enrollment.findUnique({
        where: { programId_studentId: { programId: program.id, studentId: ctx.profile.id } },
        select: { id: true },
      });
      if (enrolled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `You are enrolled as a fellow in ${program.name}, so you cannot also teach in it. ` +
            `Ask an instructor to remove your enrollment first.`,
        });
      }

      const existing = await ctx.db.programInstructor.findUnique({
        where: { programId_userId: { programId: program.id, userId: ctx.profile.id } },
        select: { id: true },
      });

      if (existing) {
        return { programId: program.id, name: program.name, added: false };
      }

      await ctx.db.programInstructor.create({
        data: { programId: program.id, userId: ctx.profile.id, isPrimary: false },
        select: { id: true },
      });

      return { programId: program.id, name: program.name, added: true };
    }),

  /**
   * Replaces the instructor link, invalidating the old one.
   *
   * The only control over who can use it, exactly as with the join link: anybody holding it who is
   * already staff is added immediately, so a link that reached the wrong person is dealt with by
   * replacing it and removing whoever got in. Instructors already on the program are unaffected —
   * the token is how you are added, not how you stay.
   */
  regenerateInstructorToken: programProcedure.mutation(async ({ ctx, input }) => {
    return ctx.db.program.update({
      where: { id: input.programId },
      data: { instructorToken: newJoinToken() },
      select: { id: true, instructorToken: true },
    });
  }),

  /**
   * Sets which of the program's instructors teach one of its courses.
   *
   * **This grants nothing.** Every instructor of the program can already author and grade in every
   * course of it. What it decides is whose name is on the course, who is added as a collaborator on
   * the repositories it generates — see `lib/assignments/accept.ts` — and which course an
   * instructor's screens open on. Getting it wrong costs a GitHub notification, not access.
   *
   * The whole list rather than "add this one", for the reason `cohorts.setPlacements` takes the whole
   * placement: it is idempotent and cannot leave a half-applied state.
   *
   * **Every id must already instruct the program**, which the composite foreign key makes
   * unrepresentable anyway — `(programId, userId)` references `program_instructors`. This is what
   * turns the database's refusal into a sentence somebody can act on.
   *
   * Owner-gated, because deciding who works which course is a decision about other people's work.
   */
  setCourseInstructors: programProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        userIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOwnsProgram(ctx, input.programId, "decide who teaches in");

      const course = await ctx.db.course.findFirst({
        where: { id: input.courseId, programId: input.programId },
        select: { id: true, name: true },
      });

      if (!course) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That course does not belong to this program.",
        });
      }

      const wanted = [...new Set(input.userIds)];

      if (wanted.length > 0) {
        const instructs = await ctx.db.programInstructor.findMany({
          where: { programId: input.programId, userId: { in: wanted } },
          select: { userId: true },
        });

        if (instructs.length !== wanted.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "That list names somebody who does not instruct this program. Send them the " +
              "instructor link first.",
          });
        }
      }

      /*
        The difference is written, not the whole set — two statements and no transaction around
        them, for the reason `cohorts.setPlacements` has none: Prisma refuses a nested interactive
        transaction, so one here would fail outright for every check script. Writing the difference
        is what makes doing it without one safe: delete-then-insert leaves a course with nobody's
        name on it if the insert fails, and this leaves a coherent list either way.
      */
      const existing = await ctx.db.courseInstructor.findMany({
        where: { courseId: course.id },
        select: { userId: true },
      });

      const has = new Set(existing.map((row) => row.userId));
      const toAdd = wanted.filter((userId) => !has.has(userId));
      const toRemove = [...has].filter((userId) => !wanted.includes(userId));

      if (toRemove.length > 0) {
        await ctx.db.courseInstructor.deleteMany({
          where: { courseId: course.id, userId: { in: toRemove } },
        });
      }

      if (toAdd.length > 0) {
        await ctx.db.courseInstructor.createMany({
          data: toAdd.map((userId) => ({
            courseId: course.id,
            programId: input.programId,
            userId,
          })),
          skipDuplicates: true,
        });
      }

      return { courseId: course.id, name: course.name, teaching: wanted.length };
    }),

  /**
   * Removes an instructor from a program.
   *
   * **Refused if it would leave the program with none**, the same shape and the same reasoning as
   * revoking the last admin: a program with no instructors is unreachable by every authoring
   * procedure, all of which check `ProgramInstructor` rather than the role, and the only way back is
   * a database edit. The check is cheap and the failure is not.
   *
   * **The owner cannot be removed by anybody else**, which is the permission this whole area exists
   * for: before it, anybody who taught could remove the person who set the matriculation up. They
   * can still remove *themselves* — somebody who leaves the school should not be permanent, and
   * refusing would make "who created this" outrank "who runs it now" — and ownership then falls to
   * the longest-serving instructor left. `transferOwnership` is how they choose who instead of
   * letting the rule choose.
   *
   * **Their `CourseInstructor` rows go with them**, by the cascade on `(programId, userId)`. That is
   * the cleanup step this key removes rather than leaves to be remembered.
   *
   * Nothing is taken back on GitHub. An instructor removed here stays a collaborator on every
   * repository generated while they taught, because `accept` adds collaborators at the moment a
   * fellow accepts and those repositories hold real work. Same reasoning as leaving fellows'
   * repositories alone when an assignment is removed.
   */
  removeInstructor: programProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      /*
        Every instructor of the program in one read, rather than the target row and a count. Three of
        the four things decided below — who the target is, whether this would empty the list, and who
        owns the matriculation — are questions about the same set, and asking separately is how two of
        them come to be answered about different sets.
      */
      const instructors = await ctx.db.programInstructor.findMany({
        where: { programId: input.programId },
        select: {
          id: true,
          userId: true,
          isPrimary: true,
          createdAt: true,
          user: { select: personNameSelect },
        },
      });

      const row = instructors.find((instructor) => instructor.userId === input.userId);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That person does not instruct this program.",
        });
      }

      if (instructors.length <= 1) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This is the only instructor on the program. Add another one first — a program " +
            "with no instructors cannot be authored in or graded, and only a database edit " +
            "would bring it back.",
        });
      }

      /*
        The owner is removable by the owner and by an admin, and by nobody else.

        Leaving on your own account is a decision about your own work; removing the person who runs a
        matriculation is a decision about theirs. An admin passes because an admin is the recovery
        path when an owner has left the school without handing it on.
      */
      const owner = ownerOf(instructors);
      const callerIsOwner = owner?.userId === ctx.profile.id;

      if (owner && owner.userId === input.userId && !callerIsOwner && ctx.profile.role !== "ADMIN") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            `${displayNameOf(row.user, "that instructor")} owns this program, so only they can ` +
            `leave it. If they should hand it on, they can transfer it to somebody else first.`,
        });
      }

      await ctx.db.programInstructor.delete({ where: { id: row.id } });

      /*
        Who owns it now, said back rather than left to be noticed.

        An owner who leaves without transferring hands the program to the longest-serving instructor
        left, by the same rule that covers a deleted account. It is the right default and it is not a
        thing anybody would guess, so the screen says whose it is now.
      */
      const remaining = instructors.filter((instructor) => instructor.id !== row.id);
      const successor = owner?.userId === input.userId ? ownerOf(remaining) : null;

      return {
        programId: input.programId,
        instructorName: displayNameOf(row.user, "that instructor"),
        /** Who inherited the program, or null when the person removed did not own it. */
        newOwnerName: successor ? displayNameOf(successor.user, "that instructor") : null,
      };
    }),

  /**
   * Hands the matriculation to another of its instructors.
   *
   * **What makes "the owner cannot be removed" livable.** Without it that rule reads as "the person
   * who set this up runs it forever", and somebody leaving the school leaves behind a matriculation
   * nobody else can take responsibility for. Leaving afterwards is then the ordinary
   * `removeInstructor` they already have.
   *
   * The target has to instruct the program already. Ownership decides which of its instructors can
   * archive it and remove people, so handing it to somebody who is not one of them would be adding
   * an instructor by a second path — and the instructor link is the one place that decision is made
   * and explained.
   *
   * Cleared and then set, inside a transaction, because a partial unique index on
   * `program_instructors` allows exactly one primary row per program and is checked per statement.
   * Setting first would collide with the row being replaced.
   */
  transferOwnership: instructorProcedure
    .input(z.object({ programId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsProgram(ctx, input.programId, "hand on");

      const target = await ctx.db.programInstructor.findUnique({
        where: { programId_userId: { programId: input.programId, userId: input.userId } },
        select: { id: true, isPrimary: true, user: { select: personNameSelect } },
      });

      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "That person does not instruct this program, so they cannot own it. Send them the " +
            "instructor link first.",
        });
      }

      if (target.isPrimary) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${displayNameOf(target.user, "that instructor")} already owns this program.`,
        });
      }

      await ctx.db.$transaction(async (tx) => {
        await tx.programInstructor.updateMany({
          where: { programId: input.programId, isPrimary: true },
          data: { isPrimary: false },
        });
        await tx.programInstructor.update({
          where: { id: target.id },
          data: { isPrimary: true },
        });
      });

      return {
        programId: input.programId,
        ownerId: input.userId,
        ownerName: displayNameOf(target.user, "that instructor"),
      };
    }),

  /**
   * What deleting this matriculation would destroy. Read-only.
   *
   * Exists so the confirmation states facts rather than generalities — "4 courses, 24 fellows, 187
   * submissions, 143 released grades" is a sentence somebody can act on, and "this cannot be undone"
   * is not.
   *
   * **Archived only**, like the removal itself, so this cannot be used to preview an action that is
   * not available. Refusing here rather than returning an empty answer keeps the two in step: a
   * screen that could read the impact of something it cannot do would eventually offer to do it.
   */
  removalImpact: instructorProcedure
    .input(z.object({ programId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const program = await assertArchivedAndOwned(ctx, input.programId, "delete");

      const [courses, enrollments, instructors, cohorts, sessions, records, submissions] =
        await Promise.all([
          ctx.db.course.count({ where: { programId: program.id } }),
          ctx.db.enrollment.count({ where: { programId: program.id } }),
          ctx.db.programInstructor.count({ where: { programId: program.id } }),
          ctx.db.cohort.count({ where: { programId: program.id } }),
          ctx.db.attendanceSession.count({ where: { programId: program.id } }),
          ctx.db.attendanceRecord.count({ where: { programId: program.id } }),
          ctx.db.submission.findMany({
            where: { assignment: { course: { programId: program.id } } },
            select: {
              finalScore: true,
              repoFullName: true,
              uploadPath: true,
              _count: { select: { gradingDrafts: true, testRuns: true } },
            },
          }),
        ]);

      return {
        name: program.name,
        matriculation: program.matriculation,
        /** What has to be typed to confirm. Returned so the screen and the procedure agree. */
        confirm: program.matriculation,
        courses,
        enrollments,
        instructors,
        cohorts,
        attendanceSessions: sessions,
        attendanceRecords: records,
        submissions: submissions.length,
        releasedGrades: submissions.filter((row) => row.finalScore !== null).length,
        drafts: submissions.reduce((total, row) => total + row._count.gradingDrafts, 0),
        testRuns: submissions.reduce((total, row) => total + row._count.testRuns, 0),
        /**
         * Uploaded files, which **are** deleted — unlike the repositories below.
         *
         * The asymmetry is the point. A repository holds a fellow's own work and they can reach it
         * on GitHub whether or not this application still knows about it, so deleting it would
         * destroy something. An object in the private bucket had exactly one reader, which is the
         * row about to go, so leaving it is not preservation — it is a file nobody can ever reach
         * again, paid for forever.
         */
        uploadedFiles: submissions.filter((row) => row.uploadPath !== null).length,
        /**
         * Left alone, and reported so they can be dealt with deliberately. Losing a matriculation's
         * work on GitHub because somebody tidied a list is the worse failure.
         */
        repositories: submissions
          .map((row) => row.repoFullName)
          .filter((name): name is string => name !== null).length,
      };
    }),

  /**
   * Deletes a matriculation and everything cascading from it.
   *
   * Permanent, and there is no recovery path in the application: the program takes its courses,
   * their units, assignments, submissions, grading drafts, sections and test runs, its roster, its
   * cohorts, its attendance, and its instructor rows with it. The database's own backups are the
   * only way back, which is worth saying on a screen that can destroy a year.
   *
   * **Archived first**, always. Archiving is reversible and this is not, so making it the only path
   * means the destructive action always has a survivable step in front of it — somebody who meant
   * "take this off my list" gets what they wanted before reaching anything permanent.
   *
   * **Owner only**, the same gate as archiving. If any co-teacher could archive and then delete, the
   * ownership rules would buy nothing.
   *
   * **The typed confirmation is enforced here rather than in the dialog**, which is the whole point
   * of it: the interface warns and the procedure is what refuses. It asks for the matriculation
   * rather than the name, because a program runs every term under the same name — "Software
   * Engineering Fellowship" would confirm the wrong year as readily as the right one.
   */
  remove: instructorProcedure
    .input(z.object({ programId: z.string().uuid(), confirmMatriculation: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const program = await assertArchivedAndOwned(ctx, input.programId, "delete");

      if (
        input.confirmMatriculation.trim().toLowerCase() !== program.matriculation.toLowerCase()
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `Type the matriculation exactly to delete it. Expected "${program.matriculation}" — ` +
            `every matriculation of this program is called "${program.name}", so the term is ` +
            `what says which one.`,
        });
      }

      /*
        Counted and collected before the delete, so what is reported afterwards is what was actually
        destroyed rather than a guess — and so the upload paths still exist to be removed with. Once
        the rows are gone there is nothing left that knows where those objects are.
      */
      const submissions = await ctx.db.submission.findMany({
        where: { assignment: { course: { programId: program.id } } },
        select: {
          repoFullName: true,
          uploadPath: true,
          _count: { select: { gradingDrafts: true, testRuns: true } },
        },
      });
      const courses = await ctx.db.course.count({ where: { programId: program.id } });
      const enrollments = await ctx.db.enrollment.count({ where: { programId: program.id } });

      await ctx.db.program.delete({ where: { id: program.id } });

      /*
        The stored files, after the rows and best effort.

        After, because the database is the authoritative act: a bucket that refuses should not leave
        a matriculation half deleted. Best effort for the same reason — the paths that would not go
        are named in the result, which is the only way anybody could find them, rather than thrown as
        a failure of an operation that has already succeeded.
      */
      const uploadPaths = submissions
        .map((row) => row.uploadPath)
        .filter((path): path is string => path !== null);

      let uploadsRemoved = 0;
      let uploadsLeftBehind: string[] = [];
      if (uploadPaths.length > 0) {
        const result = await removeSubmissionUploads(uploadPaths);
        uploadsRemoved = result.removed;
        uploadsLeftBehind = result.leftBehind;
      }

      return {
        name: program.name,
        matriculation: program.matriculation,
        courses,
        enrollments,
        submissions: submissions.length,
        drafts: submissions.reduce((total, row) => total + row._count.gradingDrafts, 0),
        testRuns: submissions.reduce((total, row) => total + row._count.testRuns, 0),
        uploadsRemoved,
        /** Stored files the bucket would not remove, named so they can be found by hand. */
        uploadsLeftBehind,
        /** Untouched on GitHub, and listed so they can be dealt with deliberately. */
        orphanedRepositories: submissions
          .map((row) => row.repoFullName)
          .filter((name): name is string => name !== null),
      };
    }),
});

/**
 * Refuses unless this program is archived **and** the caller owns it, and returns it.
 *
 * Shared by `removalImpact` and `remove` so the read and the act cannot come apart. Two gates asked
 * in one place rather than four checks written twice: the day one of them is added to the mutation
 * and forgotten on the query, a screen starts previewing something it cannot do, which is how an
 * offer to do it eventually gets built.
 *
 * The archived requirement is what puts a survivable step in front of a permanent one. Archiving is
 * reversible, so somebody who meant "take this off my list" gets exactly that before reaching
 * anything that cannot be undone.
 */
async function assertArchivedAndOwned(ctx: AuthedCtx, programId: string, action: string) {
  const program = await ctx.db.program.findUnique({
    where: { id: programId },
    select: { id: true, name: true, matriculation: true, archivedAt: true },
  });

  if (!program) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Program not found." });
  }

  await assertOwnsProgram(ctx, programId, action);

  if (program.archivedAt === null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `${program.name} is still running, so it cannot be deleted. Archive it first — that ` +
        `takes it off everyone's list and can be undone, which this cannot.`,
    });
  }

  return program;
}
