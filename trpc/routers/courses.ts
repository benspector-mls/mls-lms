import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Db } from "@/lib/prisma";

import { isManualOnly } from "@/lib/assignments/spec";
import type { CourseUnitCategory } from "@/lib/course-units";
import { courseSlugProblem, MAX_COURSE_SLUG, suggestCourseSlug } from "@/lib/courses/course-slug";
import { cohortSelectionInput, parseCohortSelection } from "@/lib/programs/cohorts";
import {
  assertInstructsProgram,
  assertTeaches,
  enrollmentsIn,
  removedStudentIds,
  selectedStudentIds,
} from "@/lib/courses/membership";
import { assertOwnsProgramOfCourse, ownerOf } from "@/lib/programs/ownership";
import {
  allUnits,
  courseVerdictByStudent,
  groupByUnit,
  type UnitVerdict,
} from "@/lib/gradebook/categories";
import { undeliveredApprovalWhere } from "@/lib/grade/approve";
import { triageBucket } from "@/lib/grade/triage";
import { removeSubmissionUploads } from "@/lib/uploads/storage";

import { copyAssignmentInto, copyableAssignmentSelect } from "./assignments";
import {
  type AuthedCtx,
  courseProcedure,
  createTRPCRouter,
  instructorProcedure,
  profileProcedure,
} from "../init";
import { courseUnitSummarySelect, personSelect } from "../selects";

/** Trimmed, so " Data Science" and "Data Science" are one name to everyone but the database. */
const courseName = z.string().trim().min(1, "A course needs a name.").max(200);

export const coursesRouter = createTRPCRouter({
  /**
   * Courses the caller belongs to, either enrolled as a student or listed as an
   * instructor. Admins see every course.
   *
   * **Archived courses are returned, labelled, rather than filtered out.** They used to be
   * filtered, which meant a cohort somebody archived could be reached from nowhere in the
   * interface — every procedure still admitted its members, so the work was all there and
   * openable only by a URL somebody happened to have kept. Archiving is supposed to take a
   * cohort off the active list, not lose it.
   *
   * Each reader decides what to do with them, the same way each reader decides what to do
   * with a course a student was removed from. The course list puts them in a section of
   * their own, the switcher can name one rather than printing a bare id, and the two readers
   * that want the cohort somebody is in the middle of — `/instructor`, and copying a new
   * course from an old one — filter on `archivedAt` themselves.
   */
  listMine: profileProcedure.query(async ({ ctx }) => {
    const isAdmin = ctx.profile.role === "ADMIN";

    /*
      Every enrollment status, not just ACTIVE.

      This is the one reader where "admit a removed student" is not the whole answer. Their
      course stays in their list, because they keep reading the feedback they were given — but
      it has to be *labelled*, or it sits there indistinguishable from the cohorts they are
      still in, and a student who cannot tell the difference has been told something false.
      `enrolledAs` below is what the card reads.
    */
    const courses = await ctx.db.course.findMany({
      /*
        A course of a program the caller is on the roster of, or instructs.

        **An unpublished course is visible to its instructors and to nobody else**, which is the
        first of the three readers that have to agree about `Course.publishedAt` — the others are
        `assertCourseMember` and `distributedToStudent`. It is what replaced "not enrolling anybody
        yet" as the way to keep a course that begins in March off a fellow's screen, now that being
        on a program's roster makes somebody a student of every course of it.
      */
      where: isAdmin
        ? {}
        : {
            OR: [
              {
                publishedAt: { not: null },
                program: { enrollments: { some: { studentId: ctx.profile.id } } },
              },
              { program: { instructors: { some: { userId: ctx.profile.id } } } },
            ],
          },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        publishedAt: true,
        archivedAt: true,
        /*
          The term the course belongs to. The breadcrumb names both — "Software Engineering
          Fellowship (Fall 2026)" — because a program runs every term under the same name, and the
          switcher groups a caller's courses by it.
        */
        program: { select: { id: true, name: true, term: true, archivedAt: true } },
        // Counted here rather than fetched and measured in the interface, so the card
        // does not pull every assignment and enrollment across to say how many there
        // are.
        //
        // ACTIVE only, unlike the `where` above: this is "how many fellows does this program
        // have", which a departed one is not the answer to.
        //
        // Test students are excluded for the same reason and it is the same question. This figure
        // is the one somebody quotes — a roster of 25 must not read as 26 because an admin
        // previewed the course. They are deliberately *not* excluded from the roster, gradebook,
        // or triage, which list students rather than count them, and where a test row is the
        // point.
        _count: { select: { assignments: true } },
      },
    });

    /*
      The roster size and the caller's own standing, per program rather than per course.

      One query for both rather than a relation on every course, because they are the same facts for
      every course of one term — reading them through each course would ask the same
      question four times and invite the four answers to look independent.
    */
    const programIds = [...new Set(courses.map((course) => course.program.id))];
    const programs =
      programIds.length === 0
        ? []
        : await ctx.db.program.findMany({
            where: { id: { in: programIds } },
            select: {
              id: true,
              /*
                ACTIVE only, and test students excluded. This figure is the one somebody quotes — a
                roster of 25 must not read as 26 because an admin previewed a course. Test students
                are deliberately *not* excluded from the roster, gradebook, or triage, which list
                fellows rather than count them, and where a test row is the point.
              */
              _count: {
                select: {
                  enrollments: {
                    where: { status: "ACTIVE", student: { testStudentNumber: null } },
                  },
                },
              },
              // The caller's own enrollment, so a card can say they have left this one.
              enrollments: {
                where: { studentId: ctx.profile.id },
                select: { status: true },
                take: 1,
              },
              // Whether the caller instructs this program, which is not the same as their
              // role: an admin instructs none of them but sees all.
              instructors: {
                where: { userId: ctx.profile.id },
                select: { id: true },
                take: 1,
              },
            },
          });

    const standing = new Map(programs.map((program) => [program.id, program]));

    /*
      Whether the caller has finished each course they are a student of.

      **The one place course-level completion is read**, and until it existed nothing in the
      application could say whether anybody had finished a course at all — the card showed how
      many assignments a cohort holds and how many students are in it, neither of which is about
      the person reading it.

      One rule at three levels: an assignment is complete when `isComplete`, a unit when every
      published assignment in it is, a course when every unit that has a verdict is. The
      arithmetic is `courseVerdictByStudent`, the same function the gradebook's Overview column
      reads, so a student and their instructor cannot be shown different answers.

      Two extra queries rather than a relation on every course, and both narrowed to the courses
      the caller is *enrolled in*: an instructor's own courses get no verdict, because they are
      not doing the work, and an admin looking at every course in the system fetches nothing here
      at all. A student is in a handful of courses, so this is a handful of rows.
    */
    const studentOf = courses
      .filter((course) => (standing.get(course.program.id)?.enrollments.length ?? 0) > 0)
      .map((course) => course.id);

    const verdicts = new Map<string, UnitVerdict>();

    if (studentOf.length > 0) {
      const [units, cells] = await Promise.all([
        ctx.db.courseUnit.findMany({
          where: { courseId: { in: studentOf } },
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
        ctx.db.submission.findMany({
          where: { studentId: ctx.profile.id, assignment: { courseId: { in: studentOf } } },
          select: { assignmentId: true, studentId: true, isComplete: true },
        }),
      ]);

      for (const courseId of studentOf) {
        const own = units.filter((unit) => unit.courseId === courseId);
        const grouped = groupByUnit(
          own.flatMap((unit) => unit.assignments),
          own,
        );

        verdicts.set(
          courseId,
          courseVerdictByStudent(cells, allUnits(grouped), [ctx.profile.id]).get(ctx.profile.id) ??
            "pending",
        );
      }
    }

    return courses.map((course) => ({
      ...course,
      /** How many active fellows are on the roster of the program this course belongs to. */
      rosterCount: standing.get(course.program.id)?._count.enrollments ?? 0,
      teaches: isAdmin || (standing.get(course.program.id)?.instructors.length ?? 0) > 0,
      /** Null when the caller is not a fellow of this course's program — an instructor, or an admin. */
      enrolledAs: standing.get(course.program.id)?.enrollments[0]?.status ?? null,
      /**
       * Where the caller stands on the whole course, or null when they are not a student of it.
       *
       * "Not finished" rather than "incomplete" while anything is still with an instructor, for
       * the reason the unit verdict draws the same distinction: telling somebody they have failed
       * a course nobody has finished marking would be false.
       */
      completion: verdicts.get(course.id) ?? null,
    }));
  }),

  /**
   * One course the caller belongs to.
   *
   * Separate from `listMine` because the course screens need the course's modules — the
   * cohort's own module sequence, which is what puts the assignment groups in teaching
   * order rather than alphabetical order — and fetching every course to find one would
   * be the wrong shape.
   */
  get: profileProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUnique({
        where: { id: input.courseId },
        select: {
          id: true,
          name: true,
          publishedAt: true,
          archivedAt: true,
          program: {
            select: {
              id: true,
              name: true,
              term: true,
              archivedAt: true,
              instructors: { where: { userId: ctx.profile.id }, select: { id: true }, take: 1 },
            },
          },
          courseUnits: {
            orderBy: [{ position: "asc" }, { name: "asc" }],
            select: courseUnitSummarySelect,
          },
        },
      });

      if (!course) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
      }

      const isAdmin = ctx.profile.role === "ADMIN";
      const teaches = isAdmin || course.program.instructors.length > 0;

      if (!teaches) {
        /*
          Unpublished refuses as not-found, and before the enrollment is even looked for. To a
          fellow, a course their instructor has not published and a course that does not exist are
          the same situation, and the second wording would invite them to ask about work nobody has
          finished writing. `assertCourseMember` says the same thing the same way.
        */
        if (course.publishedAt === null) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
        }

        // Every status, not just ACTIVE: a removed fellow keeps reading the course and the feedback
        // they were given. Refusing them here is what would take it back.
        const enrollment = await ctx.db.enrollment.findFirst({
          where: { programId: course.program.id, studentId: ctx.profile.id },
          select: { id: true },
        });

        if (!enrollment) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this course.",
          });
        }
      }

      /*
        The caller's own instructor row is a probe for `teaches` above rather than something a screen
        reads, so it does not travel — a payload carrying it would invite a component to re-derive
        `teaches` from it and get a different answer for an admin, who holds no row anywhere.
      */
      const { program, ...rest } = course;

      return {
        ...rest,
        program: {
          id: program.id,
          name: program.name,
          term: program.term,
          archivedAt: program.archivedAt,
        },
        teaches,
      };
    }),

  /**
   * Every assignment in the course, with how much of each is graded and how much is waiting.
   *
   * **The counts are computed here rather than in the browser**, which is the whole reason
   * this is its own procedure. The screen used to derive them by filtering the gradebook's
   * every-student-every-assignment cell list, so listing twelve assignments meant shipping
   * three hundred grading cells to count them — and the counting happened inside a sort
   * comparator, which ran it again for every comparison.
   *
   * They are the same figures the gradebook and grading triage show, from the same
   * `triageBucket`, so the "to grade" column here cannot disagree with the pile that screen
   * lists.
   */
  assignmentsOverview: courseProcedure
    .input(z.object({ cohort: cohortSelectionInput }))
    .query(async ({ ctx, input }) => {
      /*
        The screen this feeds is the reason every group filter is applied on the server. Its
        counts are aggregated here and sent as numbers, so there is nothing left for the browser
        to narrow — filtering in the browser on the other three screens and here would leave one
        rule with two implementations, and the visible failure is a group's name above the whole
        cohort's figures.
      */
      const selection = parseCohortSelection(input.cohort);

      const course = await ctx.db.course.findUnique({
        where: { id: input.courseId },
        select: {
          id: true,
          name: true,
          programId: true,
          publishedAt: true,
          archivedAt: true,
          program: { select: { id: true, name: true, term: true } },
          // For the filter menu, which offers the course's whole module list rather than only
          // the modules that happen to hold an assignment — filtering to an empty module is a
          // legitimate way to find out that it is empty.
          courseUnits: {
            orderBy: [{ position: "asc" }, { name: "asc" }],
            select: courseUnitSummarySelect,
          },
        },
      });

      if (!course) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
      }

      const assignments = await ctx.db.assignment.findMany({
        where: { courseId: course.id },
        orderBy: [{ courseUnit: { position: "asc" } }, { title: "asc" }],
        select: {
          id: true,
          title: true,
          courseUnit: { select: courseUnitSummarySelect },
          pointValue: true,
          dueAt: true,
          kind: true,
          // Read for the grading mode and not returned. Each cell's bucket depends on whether
          // the pipeline can grade this assignment at all.
          sections: true,
          // So the list can mark an unpublished assignment as a draft. A student cannot see it
          // at all; an instructor needs to know why nobody has submitted.
          distributedAt: true,
        },
      });

      /*
        Every unit of the course, so the screen can group the assignments under the modules,
        projects, and assessments they belong to.

        Fetched whole rather than derived from the assignments above, so a unit an instructor
        has just created and not yet filled appears where they put it. Deriving the list from
        its contents would make an empty one invisible, which is indistinguishable from the
        create having failed.
      */
      const courseUnits = await ctx.db.courseUnit.findMany({
        where: { courseId: course.id },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: { ...courseUnitSummarySelect, overview: true },
      });

      const cells = await courseCells(ctx.db, course.id, assignments);

      /*
        Active students only, the same set triage works from.

        A departed fellow's work is not the course's outstanding work, so counting it here
        would leave this column claiming there is grading to do while triage shows nothing —
        with nothing on either screen to reconcile them.
      */
      const removed = await removedStudentIds(ctx.db, course.programId);
      const inSelection = await selectedStudentIds(ctx.db, course.programId, selection);
      const counts = new Map(
        assignments.map((assignment) => [
          assignment.id,
          { graded: 0, submitted: 0, outstanding: 0 },
        ]),
      );

      for (const cell of cells) {
        if (removed.has(cell.studentId)) continue;
        if (inSelection && !inSelection.has(cell.studentId)) continue;
        const entry = counts.get(cell.assignmentId);
        if (!entry) continue;
        if (cell.finalScore != null) entry.graded += 1;
        // "Handed in": accepting an assignment is not submitting it.
        if (cell.status !== "NOT_STARTED" && cell.status !== "ACCEPTED") entry.submitted += 1;
        if (cell.bucket !== null && cell.bucket !== "generating") entry.outstanding += 1;
      }

      return {
        course,
        assignments: assignments.map(({ sections, ...assignment }) => ({
          ...assignment,
          manualOnly: isManualOnly(sections),
          counts: counts.get(assignment.id) ?? { graded: 0, submitted: 0, outstanding: 0 },
        })),
        courseUnits,
      };
    }),

  /**
   * The course itself: what it is called, how its repositories are named, who is assigned to teach
   * it, and how it is published and retired.
   *
   * Also where the bare course address lands, because once every tab became a sidebar item there was
   * nothing else for `/instructor/courses/[courseId]` to be.
   *
   * **`slug` is returned here and nowhere else.** It used to be returned by nothing at all, on the
   * reasoning that it is fixed at creation and legible from any repository name the course has
   * generated — which is right about a screen that lists work and wrong about this one. A settings
   * screen is where a fact you cannot act on legitimately belongs, and an instructor who has to
   * derive their own course's short name by reading a fellow's repository name has been told to work
   * it out rather than told.
   *
   * **The two links are not here.** Both belong to the program — one admits a fellow to the roster,
   * the other admits an instructor to the whole program — so they are on `programs.settings`,
   * behind `programProcedure`. There is nothing about a course that grants anybody anything.
   */
  settings: courseProcedure.query(async ({ ctx, input }) => {
    const course = await ctx.db.course.findUnique({
      where: { id: input.courseId },
      select: {
        id: true,
        name: true,
        slug: true,
        publishedAt: true,
        archivedAt: true,
        createdAt: true,
        program: {
          select: {
            id: true,
            name: true,
            term: true,
            archivedAt: true,
            /*
              Every instructor of the term, so the screen can offer the ones who are not yet
              assigned to this course. Authority is theirs already — see `assertTeaches` — so this is
              a list of candidates for a name on a course, not a list of people to be granted
              anything.
            */
            instructors: {
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
              select: {
                id: true,
                isPrimary: true,
                createdAt: true,
                user: { select: personSelect },
              },
            },
          },
        },
        /** Who is assigned to teach this course, which is a subset of the above. */
        instructors: {
          orderBy: { createdAt: "asc" },
          select: { id: true, userId: true, createdAt: true },
        },
      },
    });

    if (!course) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
    }

    /*
      The organizations this course's repositories are created in, which is the other half of what a
      repository name is made of. Distinct values rather than a row per assignment: the question is
      which organizations are in play, and a course normally has one answer.
    */
    const orgRows = await ctx.db.assignment.findMany({
      where: { courseId: course.id, githubOrg: { not: null } },
      select: { githubOrg: true },
      distinct: ["githubOrg"],
      orderBy: { githubOrg: "asc" },
    });

    // Whether the short name is still theoretically free, which it is not once a repository has been
    // named after it. Stated on the screen rather than acted on — there is no mutation either way,
    // and knowing why is the point.
    const acceptedCount = await ctx.db.submission.count({
      where: { assignment: { courseId: course.id }, repoFullName: { not: null } },
    });

    /*
      Derived by the same function the guards use, rather than read off `isPrimary` here.

      The owner is `isPrimary` **or** the longest-serving instructor when no row holds it, and a
      screen that knew only the first half would show a program with no owner and offer a Publish or
      Archive button that the procedure then refuses.
    */
    const ownerId =
      ownerOf(course.program.instructors.map((row) => ({ ...row, userId: row.user.id })))?.userId ??
      null;

    return {
      course,
      githubOrgs: orgRows.map((row) => row.githubOrg).filter((org): org is string => org !== null),
      acceptedCount,
      /** Which of the instructors is the caller, so the screen never offers to remove them by surprise. */
      callerId: ctx.profile.id,
      /** Which of them owns the program this course belongs to. */
      ownerId,
      /**
       * Whether this caller may do the things ownership gates — publish, archive, reopen, delete,
       * decide who teaches this course.
       *
       * Not `ownerId === callerId` in the browser, because an admin acts as owner on every program
       * and holds no `ProgramInstructor` row on any of them. A screen deriving it that way would
       * hide the Archive button from the one reader who is the recovery path when an owner has left.
       */
      callerActsAsOwner: ownerId === ctx.profile.id || ctx.profile.role === "ADMIN",
    };
  }),

  /**
   * A whole course at once: its assignments, its roster, and every cell where the two
   * meet. Instructors only.
   *
   * The one read in the application that crosses both students and assignments, which is
   * what a gradebook is. Every other instructor procedure is scoped to one assignment or
   * one submission, and building this out of those would be a request per student per
   * assignment.
   *
   * Each cell carries the same `bucket` the triage screen and the grading queue sort on,
   * so the "still to grade" count against an assignment here is the same count that
   * screen shows.
   *
   * Narrowed to the grid once the roster, the assignments list, and settings became their
   * own screens — no join link, and the two enrollment complements rather than the whole
   * list. Everything still here is something the grid itself draws.
   */
  gradebook: courseProcedure
    .input(z.object({ cohort: cohortSelectionInput }))
    .query(async ({ ctx, input }) => {
      const selection = parseCohortSelection(input.cohort);

      const course = await ctx.db.course.findUnique({
        where: { id: input.courseId },
        select: {
          id: true,
          name: true,
          programId: true,
          publishedAt: true,
          archivedAt: true,
          program: { select: { id: true, name: true, term: true } },
        },
      });

      if (!course) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
      }

      const [assignments, courseUnits, enrollments] = await Promise.all([
        ctx.db.assignment.findMany({
          where: { courseId: course.id },
          orderBy: [{ courseUnit: { position: "asc" } }, { title: "asc" }],
          select: {
            id: true,
            title: true,
            /*
              The id flat as well as the unit itself, because `groupByUnit` places an assignment
              by `courseUnitId` and the grid's filter menu names the unit by its own name. Two
              readings of one fact, from one row.
            */
            courseUnitId: true,
            courseUnit: { select: courseUnitSummarySelect },
            pointValue: true,
            dueAt: true,
            kind: true,
            // Read for the grading mode below and not returned. Each cell's bucket depends
            // on whether the pipeline can grade this assignment at all, and asking the
            // assignment once is cheaper than carrying the answer on every cell.
            sections: true,
            // So the grid can mark an unpublished assignment as a draft. A student
            // cannot see it at all; an instructor needs to know why.
            distributedAt: true,
          },
        }),
        /*
          Every unit of the course, which is what the grid's three category tabs are drawn from.

          A separate query rather than a relation on each assignment, because a course holds a
          handful of units against fifty assignments — fetching the unit through every one of
          them would send the same few names over and over. Nothing here needs the assignments:
          `groupByUnit` attaches them from the list above, which is what keeps the two from
          describing different sets of work.
        */
        ctx.db.courseUnit.findMany({
          where: { courseId: course.id },
          orderBy: [{ position: "asc" }, { name: "asc" }],
          select: courseUnitSummarySelect,
        }),
        /*
          Every status, then split into complements below. The grid must not count a removed
          student, or a departed student reads as somebody with unfinished work forever — but
          it does show their rows in a table of their own, which needs them fetched.

          Narrowed by the selected group here, which is what makes this the one list the grid is
          built from: the rows, the removed table, and the cells below all follow from it, so
          there is no way for the grid to show a group's students and count somebody else's work.
        */
        ctx.db.enrollment.findMany({
          where: enrollmentsIn(course.programId, selection),
          orderBy: [{ status: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            status: true,
            student: {
              select: personSelect,
            },
          },
        }),
      ]);

      const cells = await courseCells(ctx.db, course.id, assignments);

      // Everybody not currently active, for the same reason as the two lists below: the set and
      // its complement have to cover the roster.
      const removed = new Set(
        enrollments
          .filter((enrollment) => enrollment.status !== "ACTIVE")
          .map((enrollment) => enrollment.student.id),
      );

      /*
        Whose cells this grid is allowed to hold, or null when nothing is selected.

        `courseCells` reads every submission in the course, so without this the grid would list
        the group's students and still carry everybody else's cells — invisible in the grid,
        which draws by row, and wrong in every figure computed from the array.

        Read off the roster above rather than queried again, so the rows and the cells cannot be
        narrowed by two different answers to the same question. Null when unfiltered, which
        leaves the previous behaviour exactly: a submission whose student somehow has no
        enrollment row stays where it was rather than vanishing from their own gradebook.
      */
      const visible =
        selection.kind === "all"
          ? null
          : new Set(enrollments.map((enrollment) => enrollment.student.id));

      return {
        course,
        assignments: assignments.map(({ sections, ...assignment }) => ({
          ...assignment,
          /** Whether this assignment is graded by hand, which the header cell shows. */
          manualOnly: isManualOnly(sections),
        })),
        /**
         * Every unit of the course, which is what the grid's three category tabs are drawn
         * from.
         *
         * Returned whole rather than filtered to the ones holding work, so a project an
         * instructor created a moment ago appears on its tab before anything is in it.
         */
        courseUnits,
        /*
          Active, and everything else — not "active" and "removed". The two are complements, so
          every enrollment is in exactly one of them and nobody can go missing from both. That
          matters the day a third status exists: `REMOVED` is the only non-active value today, and
          a pair of filters naming both values would silently drop an `AUDITING` student from the
          roster and the gradebook alike, which is the kind of absence nothing reports.
        */
        activeEnrollments: enrollments.filter((enrollment) => enrollment.status === "ACTIVE"),
        removedEnrollments: enrollments.filter((enrollment) => enrollment.status !== "ACTIVE"),
        /**
         * One entry per submission by a student **currently in the cohort**.
         *
         * A student who has not accepted an assignment has no row, and the grid renders that gap
         * as a gap rather than as a zero — never having started is not the same as having scored
         * nothing.
         *
         * Active only, because every reader of this list is asking about the roster's present
         * state: the gradebook grid, the "N submissions waiting on you" in the course heading, and
         * the per-assignment "to grade" column. All three have to agree with grading triage, and
         * that is the set triage works from. Getting this wrong is quiet — the heading claims work
         * is waiting and triage shows nothing to do, with no way to reconcile them.
         */
        cells: cells.filter(
          (cell) =>
            !removed.has(cell.studentId) && (visible === null || visible.has(cell.studentId)),
        ),
        /**
         * The same, for fellows who have been removed — their record, not the roster's state.
         *
         * A departed student's work is kept and shown in its own table. This is the point of
         * removing rather than deleting: how somebody did before they left the program is worth
         * being able to read afterwards, and the alternative takes it back.
         *
         * Partitioned from one query rather than fetched separately, so the two are exhaustive.
         */
        removedCells: cells.filter((cell) => removed.has(cell.studentId)),
        /**
         * Which cohort this grid was built for, so the screen can name what it narrowed to.
         *
         * A gradebook showing eight rows is a different claim depending on whether the roster has
         * eight fellows, and the heading is the only place that can say which.
         */
        cohortSelection: input.cohort,
      };
    }),

  // =====================================================================================
  // Creating and retiring a cohort
  //
  // Both teach-gate on the course rather than merely requiring the INSTRUCTOR role, except
  // `create`, which has no course to gate on yet — any instructor may start one, because a
  // cohort belongs to whoever runs it.
  // =====================================================================================

  /**
   * Creates a course, optionally copying another one's modules and assignments.
   *
   * **The creator becomes the primary instructor in the same transaction**, and that is not a
   * convenience. Every authoring procedure checks `CourseInstructor` rather than the role, so a
   * course whose row was not written is a course its own creator cannot add anything to — and
   * it looks entirely normal until they try.
   */
  create: instructorProcedure
    .input(
      z.object({
        /** The program this course belongs to. Any instructor of it may add a course. */
        programId: z.string().uuid(),
        name: courseName,
        /**
         * The course's short name, which prefixes every repository it generates.
         *
         * Optional, and derived from the course name and the program's term when absent —
         * so a caller that does not care gets `fse-f26` and the form can offer `swe-f26` instead.
         * Validated rather than slugified on arrival: silently rewriting somebody's `F26` to `f26`
         * is fine, but silently rewriting `spring/26` to `spring-26` would put a name they did not
         * choose into every repository.
         */
        slug: z.string().trim().toLowerCase().max(MAX_COURSE_SLUG).optional(),
        /** Copies its units and, unpublished, its assignments. */
        copyFromCourseId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      /*
        The program has to be one the caller instructs, and it has to be running. There is no
        `programProcedure` to lean on here because this procedure also names a *second* course in
        its input, and the guard it wants is about the program.
      */
      await assertInstructsProgram(ctx, input.programId);

      const program = await ctx.db.program.findUnique({
        where: { id: input.programId },
        select: { id: true, name: true, term: true, archivedAt: true },
      });

      if (!program) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That program does not exist." });
      }

      if (program.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${program.name} is archived, so no more courses can be added to it.`,
        });
      }

      const slug = input.slug || suggestCourseSlug({ courseName: input.name, term: program.term });
      const slugProblem = courseSlugProblem(slug);
      if (slugProblem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: slugProblem });
      }

      /*
        Read before the transaction opens, and only what a copy needs.

        The source has to be a course the caller teaches — copying from one they cannot see
        would let an instructor read another cohort's assignment configuration, including which
        private repository holds its answer keys.
      */
      let source: {
        /*
          The category travels with the name and the position, because `copyAssignmentInto`
          matches a unit across courses on both — a project's deliverable landing in a module
          that happens to share the name is a wrong answer that looks like a right one.
        */
        courseUnits: { name: string; position: number; category: CourseUnitCategory }[];
        assignmentIds: string[];
      } | null = null;

      if (input.copyFromCourseId) {
        /*
          The source has to be a course the caller teaches — copying from one they cannot see
          would let an instructor read another cohort's assignment configuration, including
          which private repository holds its answer keys.

          `assertTeaches` rather than a check written out here, which is what it was. There is
          no `courseProcedure` to lean on: the course this procedure gates on is the one it is
          about to create, and this is a second course named in its input.
        */
        await assertTeaches(ctx, input.copyFromCourseId);

        const found = await ctx.db.course.findUnique({
          where: { id: input.copyFromCourseId },
          select: {
            courseUnits: {
              orderBy: { position: "asc" },
              select: { name: true, position: true, category: true },
            },
            assignments: {
              orderBy: [{ courseUnit: { position: "asc" } }, { title: "asc" }],
              select: { id: true },
            },
          },
        });

        if (!found) {
          throw new TRPCError({ code: "NOT_FOUND", message: "That course does not exist." });
        }

        source = {
          courseUnits: found.courseUnits,
          assignmentIds: found.assignments.map((assignment) => assignment.id),
        };
      }

      /*
        The course, its instructor row, and its modules in one transaction.

        The assignments are deliberately *outside* it — see below.
      */
      const course = await ctx.db.$transaction(async (tx) => {
        const created = await tx.course
          .create({
            data: {
              programId: input.programId,
              name: input.name,
              slug,
            },
            select: { id: true, name: true, slug: true, programId: true, publishedAt: true },
          })
          .catch((err: unknown) => {
            /*
              The one collision the database refuses, said in words.

              Rarer than it was, now that the suggestion names the course as well as the term — it
              used to be that every program starting in the same season collided. What still
              collides is two courses of the *same* program with similar names, and a raw constraint
              error would name a column rather than the thing to change.
            */
            if ((err as { code?: string }).code === "P2002") {
              throw new TRPCError({
                code: "CONFLICT",
                message:
                  `Another course already uses "${slug}" as its short name. Every course needs ` +
                  `its own, because it prefixes the repository names — pick something like ` +
                  `"${slug}-2".`,
              });
            }
            throw err;
          });

        /*
          Assigned to its creator, which puts their name on it and makes them a collaborator on every
          repository it generates. It grants nothing — every instructor of the program can already
          author here — so this is a default rather than a permission, and the owner can change it on
          the program's settings screen.

          Written beside the course rather than nested inside its create, because `CourseInstructor`
          reaches its course through `(courseId, programId)` and a nested create cannot name the
          second half of a composite relation.
        */
        await tx.courseInstructor.create({
          data: { courseId: created.id, programId: input.programId, userId: ctx.profile.id },
          select: { id: true },
        });

        if (source && source.courseUnits.length > 0) {
          /*
            Names and categories carried across exactly, because `duplicate` matches a unit
            across courses by both and refuses when it finds none. Renaming them is safe *after*
            the assignments land, since the unit id is the identity.
          */
          await tx.courseUnit.createMany({
            data: source.courseUnits.map((unit) => ({
              courseId: created.id,
              name: unit.name,
              position: unit.position,
              category: unit.category,
            })),
          });
        }

        return created;
      });

      /*
        Assignments copied one at a time, after the transaction, and not atomically.

        Each one goes through `assignments.duplicate`, which re-validates against the target
        course — both repositories are reached over the network, so twelve assignments is
        twelve rounds of GitHub calls. Holding a database transaction open across that is how
        a pool gets exhausted, and `duplicate` is written to be called this way.
      */
      let copied = 0;
      const failed: { title: string; reason: string }[] = [];

      if (source) {
        for (const assignmentId of source.assignmentIds) {
          const original = await ctx.db.assignment.findUnique({
            where: { id: assignmentId },
            select: copyableAssignmentSelect,
          });
          if (!original) continue;

          try {
            await copyAssignmentInto(ctx.db, {
              source: original,
              targetCourseId: course.id,
              dueAt: null,
            });
            copied += 1;
          } catch (err) {
            /*
              Reported rather than rolled back, and the course keeps the ones that worked.

              An assignment can legitimately fail to copy — a template repository made private
              since last term, an answer key folder renamed upstream — and discarding a whole
              new cohort because one of twelve needs attention would be the wrong trade. The
              instructor is told which, and adds those by hand.
            */
            failed.push({
              title: original.title,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      return { course, copied, failed };
    }),

  /**
   * Retires a cohort, or brings it back.
   *
   * The course leaves every active list and stays readable to the people who were in it;
   * nothing new can be submitted, and its submissions leave triage and the grading queue.
   * Reversible on purpose — a tidying action that cannot be undone gets avoided rather than
   * used, and an instructor who archives the wrong cohort should not need the database.
   *
   * **Owner only, in both directions** — the owner of the program this course belongs to, since
   * ownership is a program fact. This is one of the two actions a single instructor takes that
   * change what every fellow sees, which is why it is not merely teach-gated like everything else on
   * the settings screen. Reopening is the same gate because it is the same mutation with a boolean,
   * and the consequence is worth knowing rather than discovering: a co-teacher finds an archived
   * course in their list, reads all of it, and cannot bring it back. That is the right side to err on
   * — a course somebody else retired is not theirs to un-retire.
   */
  setArchived: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsProgramOfCourse(ctx, input.courseId, input.archived ? "archive" : "reopen");

      return ctx.db.course.update({
        where: { id: input.courseId },
        data: { archivedAt: input.archived ? new Date() : null },
        select: { id: true, name: true, archivedAt: true },
      });
    }),

  /**
   * Renames a course. The short name is untouched and cannot be reached from here.
   *
   * **Free, because the name is display and only display.** Nothing looks a course up by it, no
   * constraint holds it, and every reader — a card, a breadcrumb, a heading, a calendar event's
   * description, an audit event's label — is showing it to somebody rather than matching on it. The
   * one visible consequence is the right one: a subscribed calendar shows the new name the next time
   * it fetches the feed.
   *
   * **The short name is the opposite and stays that way.** It is in the name of every repository the
   * course has generated, so renaming it here would rename nothing on GitHub and leave the
   * application describing repositories that do not exist. There is no procedure that changes it,
   * which is what the review step on the creation form exists to make sure somebody reads.
   *
   * Instructor-gated rather than owner-only, unlike publishing and archiving. Those two change
   * whether a fellow can reach the course at all; this changes what it is called, which is the same
   * kind of act as renaming a module or a cohort — and both of those are any instructor's.
   */
  rename: courseProcedure.input(z.object({ name: courseName })).mutation(async ({ ctx, input }) =>
    ctx.db.course.update({
      where: { id: input.courseId },
      data: { name: input.name },
      select: { id: true, name: true },
    }),
  ),

  /**
   * Publishes a course, or takes it back to a draft.
   *
   * **What replaced "do not enroll anybody yet".** Being on a program's roster now makes somebody a
   * student of every course of it, so the lever that used to keep a course beginning in March off a
   * fellow's screen is gone. This is the one that replaced it, and it means exactly what
   * `Assignment.distributedAt` means one level down: instructors see the course and author in it, and
   * fellows do not see it at all.
   *
   * **Unpublishing is allowed, and is not the same as archiving.** A course pulled back to a draft
   * was published by mistake or is being rewritten; an archived one is finished. Both are reversible,
   * and they are separate columns because a finished course must not read as one that has not started
   * — the fellow who did the work would lose the record of it.
   *
   * Owner only, the same gate as archiving and for the same reason: it changes what every fellow on
   * the roster sees.
   */
  setPublished: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), published: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsProgramOfCourse(
        ctx,
        input.courseId,
        input.published ? "publish" : "unpublish",
      );

      return ctx.db.course.update({
        where: { id: input.courseId },
        data: { publishedAt: input.published ? new Date() : null },
        select: { id: true, name: true, publishedAt: true },
      });
    }),

  /**
   * What deleting this course would destroy. Read-only.
   *
   * Exists so the confirmation states facts rather than generalities — "12 assignments, 187
   * submissions, 143 released grades" is a sentence somebody can act on, and "this cannot be undone"
   * is not. Same shape as `assignments.removalImpact`, at the grain of a whole course.
   *
   * **The roster is not part of it.** Enrollments, cohorts, and attendance belong to the program, so
   * deleting one course of a program leaves every fellow exactly where they were. That is the
   * difference between this and `programs.remove`, and the confirmation should say so.
   *
   * **Archived only**, like the removal itself, so this cannot be used to preview an action
   * that is not available. Refusing here rather than returning an empty answer keeps the two in
   * step: a screen that could read the impact of something it cannot do would eventually offer
   * to do it.
   */
  removalImpact: instructorProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const course = await assertArchivedAndOwned(ctx, input.courseId, "delete");

      const [enrollments, assignments, courseUnits, instructors, submissions] = await Promise.all([
        ctx.db.enrollment.count({ where: { programId: course.programId } }),
        ctx.db.assignment.count({ where: { courseId: course.id } }),
        ctx.db.courseUnit.count({ where: { courseId: course.id } }),
        ctx.db.courseInstructor.count({ where: { courseId: course.id } }),
        ctx.db.submission.findMany({
          where: { assignment: { courseId: course.id } },
          select: {
            finalScore: true,
            repoFullName: true,
            uploadPath: true,
            _count: { select: { gradingDrafts: true, testRuns: true } },
          },
        }),
      ]);

      return {
        name: course.name,
        term: course.program.term,
        /** What has to be typed to confirm. Returned so the screen and the procedure agree. */
        slug: course.slug,
        /**
         * The size of the program's roster, which is **not** what deleting this course removes.
         *
         * Named here anyway, because it is what the submission and grade counts below are measured
         * against and a reader would otherwise have to guess the denominator. Enrollments belong to
         * the program and survive: deleting one course of four leaves everybody on the roster,
         * in their cohort, with their attendance intact.
         */
        enrollments,
        assignments,
        courseUnits,
        instructors,
        submissions: submissions.length,
        releasedGrades: submissions.filter((row) => row.finalScore !== null).length,
        drafts: submissions.reduce((total, row) => total + row._count.gradingDrafts, 0),
        testRuns: submissions.reduce((total, row) => total + row._count.testRuns, 0),
        /**
         * Uploaded files, which **are** deleted — unlike the repositories below.
         *
         * The asymmetry is the point. A repository holds a student's own work and they can
         * reach it on GitHub whether or not this application still knows about it, so deleting
         * it would destroy something. An object in the private bucket had exactly one reader,
         * which is the row about to go, so leaving it is not preservation — it is a file
         * nobody can ever reach again, paid for forever.
         */
        uploadedFiles: submissions.filter((row) => row.uploadPath !== null).length,
        /**
         * Left alone, and reported so they can be dealt with deliberately. Losing a cohort's
         * work on GitHub because somebody tidied a course list is the worse failure.
         */
        repositories: submissions
          .map((row) => row.repoFullName)
          .filter((name): name is string => name !== null).length,
      };
    }),

  /**
   * Deletes a course and everything cascading from it.
   *
   * Permanent, and there is no recovery path in the application: the course takes its units,
   * assignments, submissions, grading drafts, sections, test runs, team sets, and the rows naming who
   * taught it. The database's own backups are the only way back, which is worth saying on a screen
   * that can destroy a term of work.
   *
   * **The roster survives.** Enrollments, cohorts, and attendance belong to the program, so this
   * leaves every fellow where they were. Deleting the program is `programs.remove`.
   *
   * **Archived first**, always. Archiving is reversible and this is not, so making it the only
   * path means the destructive action always has a survivable step in front of it — somebody
   * who meant "take this off my list" gets what they wanted before reaching anything permanent.
   *
   * **Owner only**, the same gate as archiving. If any co-teacher could archive and then delete,
   * the ownership rules would buy nothing.
   *
   * **The typed confirmation is enforced here rather than in the dialog**, which is the whole point
   * of it: the interface warns and the procedure is what refuses. It asks for the short name rather
   * than the course name, because a program runs the same courses every term — "Fullstack Software
   * Engineering" would confirm last year's as readily as this year's, and the short name is the thing
   * that is unique across every course of every program.
   */
  remove: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), confirmSlug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const course = await assertArchivedAndOwned(ctx, input.courseId, "delete");

      if (input.confirmSlug.trim().toLowerCase() !== course.slug) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `Type the course's short name exactly to delete it. Expected "${course.slug}" — a ` +
            `program runs the same courses every term, so the short name is what says which one.`,
        });
      }

      /*
        Counted and collected before the delete, so what is reported afterwards is what was
        actually destroyed rather than a guess — and so the upload paths still exist to be
        removed with. Once the rows are gone there is nothing left that knows where those
        objects are.
      */
      const submissions = await ctx.db.submission.findMany({
        where: { assignment: { courseId: course.id } },
        select: {
          repoFullName: true,
          uploadPath: true,
          _count: { select: { gradingDrafts: true, testRuns: true } },
        },
      });
      const enrollments = await ctx.db.enrollment.count({ where: { programId: course.programId } });
      const assignments = await ctx.db.assignment.count({ where: { courseId: course.id } });

      await ctx.db.course.delete({ where: { id: course.id } });

      /*
        The stored files, after the rows and best effort.

        After, because the database is the authoritative act: a bucket that refuses should not
        leave a cohort half deleted. Best effort for the same reason — the paths that would not
        go are named in the result, which is the only way anybody could find them, rather than
        thrown as a failure of an operation that has already succeeded.
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
        name: course.name,
        term: course.program.term,
        /** The program's roster, untouched by this — see `removalImpact`. */
        enrollments,
        assignments,
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

  /*
    There is deliberately no `setSlug`.

    The short name is settled when the course is created and never again. It prefixes every
    repository the course generates, so the only window in which changing it means anything is
    before the first Accept — and a mutation that is legal for a few hours and refused forever
    after is a rule every reader has to learn, a check to keep correct, and a screen that has to
    explain which state it is in. What it buys is correcting a typo, in a window measured against
    a nine-month cohort.

    It also cost more than that. "Editable until somebody accepts" made "has anybody ever accepted"
    a question the gradebook had to answer, which is the one reader that needed *every* submission
    rather than the active students' — so filtering removed students out of the gradebook would
    have quietly reported a cohort's name as free to change while repositories were already named
    after it. Removing the mutation removed that reader.

    A typo caught after creating a course is fixed by creating it again, or by a one-line database
    update, which is safe for exactly as long as the course has no submissions.
  */

  /*
    There is deliberately nothing here about the join link, co-teaching, instructors, or ownership.

    All four belong to the term rather than to one of its courses, and all four are in
    `programs.ts`: `regenerateJoinToken`, the instructor link and the pair that redeems it,
    `setCourseInstructors`, `removeInstructor`, and `transferOwnership`. What is left in this router
    is a course's curriculum, its gradebook, and its own life cycle — which is the division the
    program was introduced to make.
  */
});

/**
 * Every submission in a course, each carrying the triage bucket it falls into.
 *
 * Shared by the gradebook and the assignments list, which is the point: they are the same
 * claim about the same work seen at two grains, and the day they were computed separately is
 * the day one of them starts disagreeing with grading triage. `triageBucket` is the single
 * authority, and this is the single place a whole course's worth of it is derived.
 *
 * The caller decides what to do about removed students, because the two want opposite things:
 * the gradebook shows them in a table of their own, and the assignments list must not count
 * them. Filtering here would take that decision away from both.
 */
async function courseCells(
  db: Db,
  courseId: string,
  assignments: { id: string; sections: unknown }[],
) {
  const submissions = await db.submission.findMany({
    where: { assignment: { courseId } },
    select: {
      id: true,
      assignmentId: true,
      studentId: true,
      status: true,
      isLate: true,
      headSha: true,
      gradedHeadSha: true,
      finalScore: true,
      finalScorePossible: true,
      isComplete: true,
      // Whether this row is one member's copy of their team's grade, which the bucket reads.
      teamSubmissionId: true,
      // The current round, never a discarded one — see `reviewableSubmissionSelect`.
      // The gradebook's cells read the same buckets the queue does and must agree with it.
      gradingDrafts: {
        where: { status: { not: "SUPERSEDED" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, headSha: true },
      },
    },
  });

  const undelivered = await db.gradingDraft.findMany({
    where: undeliveredApprovalWhere({ assignment: { courseId } }),
    select: { submissionId: true },
    distinct: ["submissionId"],
  });
  const undeliveredIds = new Set(undelivered.map((draft) => draft.submissionId));

  // Asked once per assignment rather than once per cell. Whether the pipeline can grade an
  // assignment at all is a property of the assignment, and a roster of twenty-five turns that
  // into twenty-five identical answers otherwise.
  const manualOnlyByAssignment = new Map(
    assignments.map((assignment) => [assignment.id, isManualOnly(assignment.sections)]),
  );

  return submissions.map(({ gradingDrafts, ...submission }) => {
    const draft = gradingDrafts[0] ?? null;
    const draftIsStale =
      draft != null && submission.headSha != null && draft.headSha !== submission.headSha;

    return {
      ...submission,
      bucket: triageBucket(submission.status, draft, {
        draftIsStale,
        hasUndeliveredApproval: undeliveredIds.has(submission.id),
        isManualOnly: manualOnlyByAssignment.get(submission.assignmentId) ?? false,
        /*
          A mirror keeps its cell — the student really does have that grade, and the gradebook is
          the record — but it is not work, so its bucket is null. That is the whole of what the
          gradebook and the assignments list needed to learn: one team's project counts once in
          "waiting on you" and once in the "to grade" column, and every member of it still has a
          score in their own row.
        */
        mirrorsAnotherSubmission: submission.teamSubmissionId !== null,
      }),
    };
  });
}

/**
 * Refuses unless this course is archived **and** the caller owns it, and returns it.
 *
 * Shared by `removalImpact` and `remove` so the read and the act cannot come apart. Two gates
 * asked in one place rather than four checks written twice: the day one of them is added to the
 * mutation and forgotten on the query, a screen starts previewing something it cannot do, which
 * is how an offer to do it eventually gets built.
 *
 * The archived requirement is what puts a survivable step in front of a permanent one. Archiving
 * is reversible, so somebody who meant "take this off my list" gets exactly that before reaching
 * anything that cannot be undone.
 */
async function assertArchivedAndOwned(ctx: AuthedCtx, courseId: string, action: string) {
  const course = await ctx.db.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      name: true,
      slug: true,
      programId: true,
      archivedAt: true,
      program: { select: { term: true } },
    },
  });

  if (!course) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
  }

  await assertOwnsProgramOfCourse(ctx, courseId, action);

  if (course.archivedAt === null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `${course.name} is still running, so it cannot be deleted. Archive it first — that ` +
        `takes it off everyone's list and can be undone, which this cannot.`,
    });
  }

  return course;
}
