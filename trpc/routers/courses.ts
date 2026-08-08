import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Db } from "@/lib/prisma";

import { isManualOnly } from "@/lib/assignments/spec";
import { cohortSlugProblem, MAX_COHORT_SLUG, suggestCohortSlug } from "@/lib/courses/cohort-slug";
import { newJoinToken } from "@/lib/courses/join-token";
import { groupSelectionInput, parseGroupSelection } from "@/lib/courses/groups";
import {
  assertTeaches,
  enrollmentsIn,
  removedStudentIds,
  selectedStudentIds,
} from "@/lib/courses/membership";
import { assertOwnsCourse, ownerOf } from "@/lib/courses/ownership";
import { undeliveredApprovalWhere } from "@/lib/grade/approve";
import { triageBucket } from "@/lib/grade/triage";

import {
  type AuthedCtx,
  courseProcedure,
  createTRPCRouter,
  instructorProcedure,
  profileProcedure,
} from "../init";
import { displayNameOf, moduleSummarySelect, personNameSelect, personSelect } from "../selects";

export const coursesRouter = createTRPCRouter({
  /**
   * Courses the caller belongs to, either enrolled as a student or listed as an
   * instructor. Admins see every course.
   *
   * **Archived cohorts are returned, labelled, rather than filtered out.** They used to be
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
        cohortTerm: true,
        archivedAt: true,
        // Counted here rather than fetched and measured in the interface, so the card
        // does not pull every assignment and enrollment across to say how many there
        // are.
        //
        // ACTIVE only, unlike the `where` above: this is "how many students does this cohort
        // have", which a departed one is not the answer to.
        _count: {
          select: {
            assignments: true,
            enrollments: { where: { status: "ACTIVE" } },
          },
        },
        // The caller's own enrollment, so a card can say they have left this one.
        enrollments: {
          where: { studentId: ctx.profile.id },
          select: { status: true },
          take: 1,
        },
        // Whether the caller teaches this particular course, which is not the same as
        // their role: an admin teaches none of them but sees all, and an instructor may
        // be enrolled in a course they do not teach. The instructor link on each card
        // reads this rather than the role.
        instructors: {
          where: { userId: ctx.profile.id },
          select: { id: true },
          take: 1,
        },
      },
    });

    return courses.map(({ instructors, enrollments, ...course }) => ({
      ...course,
      teaches: isAdmin || instructors.length > 0,
      /** Null when the caller is not a student of this course — an instructor, or an admin. */
      enrolledAs: enrollments[0]?.status ?? null,
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
          cohortTerm: true,
          archivedAt: true,
          modules: {
            orderBy: [{ position: "asc" }, { name: "asc" }],
            select: moduleSummarySelect,
          },
          instructors: { where: { userId: ctx.profile.id }, select: { id: true }, take: 1 },
        },
      });

      if (!course) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
      }

      const isAdmin = ctx.profile.role === "ADMIN";

      if (!isAdmin && course.instructors.length === 0) {
        // Every status, not just ACTIVE: a removed student keeps reading the course and the
        // feedback they were given. Refusing them here is what would take it back.
        const enrollment = await ctx.db.enrollment.findFirst({
          where: { courseId: course.id, studentId: ctx.profile.id },
          select: { id: true },
        });

        if (!enrollment) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this course.",
          });
        }
      }

      const { instructors, ...rest } = course;

      return { ...rest, teaches: isAdmin || instructors.length > 0 };
    }),

  /**
   * The roster: everybody who has ever joined this cohort, and the link that lets them.
   *
   * Its own read rather than a slice of the gradebook, because the two screens want
   * genuinely different rows. This one needs every enrollment and no submissions at all;
   * the gradebook needs every submission and only the active enrollments. Serving both
   * from one payload meant opening the roster fetched a term's worth of grading cells to
   * display a list of names.
   *
   * **Every status, and deliberately not filtered here.** A removed student has to appear —
   * they are who Restore acts on, and a roster that silently omitted them would make removal
   * look like deletion. The screen splits them into their own table.
   */
  roster: courseProcedure.query(async ({ ctx, input }) => {
    const course = await ctx.db.course.findUnique({
      where: { id: input.courseId },
      select: {
        id: true,
        name: true,
        cohortTerm: true,
        archivedAt: true,
        /*
            The join link. Safe here and nowhere a student can reach: this procedure is
            `instructorProcedure` *and* teach-gated above. It must never appear in `get` or
            `assignments.listForCourse`, both of which answer to students — a link in a
            payload is a link that has leaked.
          */
        joinToken: true,
      },
    });

    if (!course) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
    }

    const enrollments = await ctx.db.enrollment.findMany({
      where: { courseId: course.id },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        status: true,
        student: {
          select: personSelect,
        },
      },
    });

    return { course, enrollments };
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
    .input(z.object({ group: groupSelectionInput }))
    .query(async ({ ctx, input }) => {
      /*
        The screen this feeds is the reason every group filter is applied on the server. Its
        counts are aggregated here and sent as numbers, so there is nothing left for the browser
        to narrow — filtering in the browser on the other three screens and here would leave one
        rule with two implementations, and the visible failure is a group's name above the whole
        cohort's figures.
      */
      const selection = parseGroupSelection(input.group);

      const course = await ctx.db.course.findUnique({
        where: { id: input.courseId },
        select: {
          id: true,
          name: true,
          cohortTerm: true,
          archivedAt: true,
          // For the filter menu, which offers the course's whole module list rather than only
          // the modules that happen to hold an assignment — filtering to an empty module is a
          // legitimate way to find out that it is empty.
          modules: {
            orderBy: [{ position: "asc" }, { name: "asc" }],
            select: moduleSummarySelect,
          },
        },
      });

      if (!course) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
      }

      const assignments = await ctx.db.assignment.findMany({
        where: { courseId: course.id },
        orderBy: [{ module: { position: "asc" } }, { title: "asc" }],
        select: {
          id: true,
          title: true,
          module: { select: moduleSummarySelect },
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

      const cells = await courseCells(ctx.db, course.id, assignments);

      /*
        Active students only, the same set triage works from.

        A departed student's work is not the cohort's outstanding work, so counting it here
        would leave this column claiming there is grading to do while triage shows nothing —
        with nothing on either screen to reconcile them.
      */
      const removed = await removedStudentIds(ctx.db, course.id);
      const inSelection = await selectedStudentIds(ctx.db, course.id, selection);
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
      };
    }),

  /**
   * The cohort itself: what it is called, how its repositories are named, who teaches it,
   * and how it is retired.
   *
   * Also where the bare course address lands, because once every tab became a sidebar item
   * there was nothing else for `/instructor/courses/[courseId]` to be.
   *
   * **`cohortSlug` is returned here and nowhere else.** It used to be returned by nothing at
   * all, on the reasoning that it is fixed at creation and legible from any repository name
   * the cohort has generated — which is right about a screen that lists work and wrong about
   * this one. A settings screen is where a fact you cannot act on legitimately belongs, and
   * an instructor who has to derive their own cohort's short name by reading a student's
   * repository name has been told to work it out rather than told.
   */
  settings: courseProcedure.query(async ({ ctx, input }) => {
    const course = await ctx.db.course.findUnique({
      where: { id: input.courseId },
      select: {
        id: true,
        name: true,
        cohortTerm: true,
        cohortSlug: true,
        archivedAt: true,
        createdAt: true,
        /*
            Same guard as the join link above, and a sharper edge: this one admits somebody to
            authoring and to every student's grades in this cohort. It is behind
            `instructorProcedure` and the teach gate, and appears in no other payload.
          */
        coTeachToken: true,
        instructors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: {
            id: true,
            isPrimary: true,
            createdAt: true,
            user: {
              select: personSelect,
            },
          },
        },
      },
    });

    if (!course) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
    }

    /*
        The organizations this cohort's repositories are created in, which is the other half of
        what a repository name is made of. Distinct values rather than a row per assignment: the
        question is which organizations are in play, and a course normally has one answer.
      */
    const orgRows = await ctx.db.assignment.findMany({
      where: { courseId: course.id, githubOrg: { not: null } },
      select: { githubOrg: true },
      distinct: ["githubOrg"],
      orderBy: { githubOrg: "asc" },
    });

    // Whether the short name is still theoretically free, which it is not once a repository
    // has been named after it. Stated on the screen rather than acted on — there is no
    // mutation either way, and knowing why is the point.
    const acceptedCount = await ctx.db.submission.count({
      where: { assignment: { courseId: course.id }, repoFullName: { not: null } },
    });

    /*
        Derived by the same function the guards use, rather than read off `isPrimary` here.

        The owner is `isPrimary` **or** the longest-serving instructor when no row holds it, and
        a screen that knew only the first half would show a cohort with no owner and offer an
        Archive button that the procedure then refuses. Null only for a course with no
        instructors at all, which `removeInstructor` refuses to create.
      */
    const ownerId =
      ownerOf(course.instructors.map((row) => ({ ...row, userId: row.user.id })))?.userId ?? null;

    return {
      course,
      githubOrgs: orgRows.map((row) => row.githubOrg).filter((org): org is string => org !== null),
      acceptedCount,
      /** Which of the instructors is the caller, so the screen never offers to remove them by surprise. */
      callerId: ctx.profile.id,
      /** Which of them owns it. */
      ownerId,
      /**
       * Whether this caller may do the things ownership gates — archive, reopen, hand the
       * cohort on, remove the owner.
       *
       * Not `ownerId === callerId` in the browser, because an admin acts as owner on every
       * course and holds no `CourseInstructor` row on any of them. A screen deriving it that
       * way would hide the Archive button from the one reader who is the recovery path when
       * an owner has left.
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
    .input(z.object({ group: groupSelectionInput }))
    .query(async ({ ctx, input }) => {
      const selection = parseGroupSelection(input.group);

      const course = await ctx.db.course.findUnique({
        where: { id: input.courseId },
        select: {
          id: true,
          name: true,
          cohortTerm: true,
          archivedAt: true,
        },
      });

      if (!course) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
      }

      const [assignments, enrollments] = await Promise.all([
        ctx.db.assignment.findMany({
          where: { courseId: course.id },
          orderBy: [{ module: { position: "asc" } }, { title: "asc" }],
          select: {
            id: true,
            title: true,
            module: { select: moduleSummarySelect },
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
          Every status, then split into complements below. The grid must not count a removed
          student, or a departed student reads as somebody with unfinished work forever — but
          it does show their rows in a table of their own, which needs them fetched.

          Narrowed by the selected group here, which is what makes this the one list the grid is
          built from: the rows, the removed table, and the cells below all follow from it, so
          there is no way for the grid to show a group's students and count somebody else's work.
        */
        ctx.db.enrollment.findMany({
          where: enrollmentsIn(course.id, selection),
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
         * Active only, because every reader of this list is asking about the cohort's present
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
         * The same, for students who have been removed — their record, not the cohort's state.
         *
         * A departed student's work is kept and shown in its own table. This is the point of
         * removing rather than deleting: how somebody did before they left the program is worth
         * being able to read afterwards, and the alternative takes it back.
         *
         * Partitioned from one query rather than fetched separately, so the two are exhaustive.
         */
        removedCells: cells.filter((cell) => removed.has(cell.studentId)),
        /**
         * Which group this grid was built for, so the screen can name what it narrowed to.
         *
         * A gradebook showing eight rows is a different claim depending on whether the cohort
         * has eight students, and the heading is the only place that can say which.
         */
        groupSelection: input.group,
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
        name: z.string().trim().min(1, "A course needs a name.").max(200),
        cohortTerm: z.string().trim().min(1, "A course needs a term.").max(120),
        /**
         * The cohort's short name, which prefixes every repository it generates.
         *
         * Optional, and derived from the term when absent — so a caller that does not care gets
         * `fall-2026` and the form can offer `f26` instead. Validated rather than slugified on
         * arrival: silently rewriting somebody's `F26` to `f26` is fine, but silently rewriting
         * `spring/26` to `spring-26` would put a name they did not choose into every repository.
         */
        cohortSlug: z.string().trim().toLowerCase().max(MAX_COHORT_SLUG).optional(),
        /** Copies its modules and, unpublished, its assignments. */
        copyFromCourseId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cohortSlug =
        input.cohortSlug ||
        suggestCohortSlug({ courseName: input.name, cohortTerm: input.cohortTerm });
      const slugProblem = cohortSlugProblem(cohortSlug);
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
        modules: { name: string; position: number }[];
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
            modules: { orderBy: { position: "asc" }, select: { name: true, position: true } },
            assignments: {
              orderBy: [{ module: { position: "asc" } }, { title: "asc" }],
              select: { id: true },
            },
          },
        });

        if (!found) {
          throw new TRPCError({ code: "NOT_FOUND", message: "That course does not exist." });
        }

        source = {
          modules: found.modules,
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
              name: input.name,
              cohortTerm: input.cohortTerm,
              cohortSlug,
              joinToken: newJoinToken(),
              coTeachToken: newJoinToken(),
              instructors: { create: { userId: ctx.profile.id, isPrimary: true } },
            },
            select: { id: true, name: true, cohortTerm: true, cohortSlug: true },
          })
          .catch((err: unknown) => {
            /*
              The one collision the database refuses, said in words.

              Rarer than it was, now that the suggestion names the course as well as the term —
              it used to be that every program starting in the same season collided. What still
              collides is two cohorts of the *same* program in the same term, and a raw
              constraint error would name a column rather than the thing to change.
            */
            if ((err as { code?: string }).code === "P2002") {
              throw new TRPCError({
                code: "CONFLICT",
                message:
                  `Another course already uses "${cohortSlug}" as its short name. Every ` +
                  `cohort needs its own, because it prefixes the repository names — pick ` +
                  `something like "${cohortSlug}-2".`,
              });
            }
            throw err;
          });

        if (source && source.modules.length > 0) {
          // Names carried across exactly, because `duplicate` matches a module across courses
          // by name and refuses when it finds none. Renaming them is safe *after* the
          // assignments land, since the module id is the identity.
          await tx.module.createMany({
            data: source.modules.map((module) => ({
              courseId: created.id,
              name: module.name,
              position: module.position,
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
        const { copyAssignmentInto, copyableAssignmentSelect } = await import("./assignments");

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
   * **Owner only, in both directions.** This is the one action a single instructor takes that
   * changes what every student in the cohort sees, which is why it is not merely teach-gated
   * like everything else on the settings screen. Reopening is the same gate because it is the
   * same mutation with a boolean, and the consequence is worth knowing rather than
   * discovering: a co-teacher finds an archived cohort in their course list, reads all of it,
   * and cannot bring it back. That is the right side to err on — a cohort somebody else
   * retired is not theirs to un-retire.
   */
  setArchived: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsCourse(ctx, input.courseId, input.archived ? "archive" : "reopen");

      return ctx.db.course.update({
        where: { id: input.courseId },
        data: { archivedAt: input.archived ? new Date() : null },
        select: { id: true, name: true, archivedAt: true },
      });
    }),

  /**
   * What deleting this cohort would destroy. Read-only.
   *
   * Exists so the confirmation states facts rather than generalities — "24 students, 12
   * assignments, 187 submissions, 143 released grades" is a sentence somebody can act on, and
   * "this cannot be undone" is not. Same shape as `assignments.removalImpact`, at the grain of
   * a whole cohort.
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

      const [enrollments, assignments, modules, instructors, submissions] = await Promise.all([
        ctx.db.enrollment.count({ where: { courseId: course.id } }),
        ctx.db.assignment.count({ where: { courseId: course.id } }),
        ctx.db.module.count({ where: { courseId: course.id } }),
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
        cohortTerm: course.cohortTerm,
        /** What has to be typed to confirm. Returned so the screen and the procedure agree. */
        cohortSlug: course.cohortSlug,
        enrollments,
        assignments,
        modules,
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
   * Deletes a cohort and everything cascading from it.
   *
   * Permanent, and there is no recovery path in the application: the course takes its modules,
   * assignments, submissions, grading drafts, sections, test runs, enrollments, and instructor
   * rows with it. The database's own backups are the only way back, which is worth saying on a
   * screen that can destroy a term.
   *
   * **Archived first**, always. Archiving is reversible and this is not, so making it the only
   * path means the destructive action always has a survivable step in front of it — somebody
   * who meant "take this off my list" gets what they wanted before reaching anything permanent.
   *
   * **Owner only**, the same gate as archiving. If any co-teacher could archive and then delete,
   * the ownership rules would buy nothing.
   *
   * **The typed confirmation is enforced here rather than in the dialog**, which is the whole
   * point of it: the interface warns and the procedure is what refuses. It asks for the short
   * name rather than the course name, because a program runs every term under the same name —
   * "Software Engineering Fellowship" would confirm the wrong cohort as readily as the right
   * one, and the short name is the thing that is unique to this one.
   */
  remove: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), confirmCohortSlug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const course = await assertArchivedAndOwned(ctx, input.courseId, "delete");

      if (input.confirmCohortSlug.trim().toLowerCase() !== course.cohortSlug) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `Type the cohort's short name exactly to delete it. Expected "${course.cohortSlug}" ` +
            `— every cohort of this program is called "${course.name}", so the short name is ` +
            `what says which one.`,
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
      const enrollments = await ctx.db.enrollment.count({ where: { courseId: course.id } });
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
        const { removeSubmissionUploads } = await import("@/lib/uploads/storage");
        const result = await removeSubmissionUploads(uploadPaths);
        uploadsRemoved = result.removed;
        uploadsLeftBehind = result.leftBehind;
      }

      return {
        name: course.name,
        cohortTerm: course.cohortTerm,
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
    There is deliberately no `setCohortSlug`.

    The short name is settled when the course is created and never again. It prefixes every
    repository the cohort generates, so the only window in which changing it means anything is
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

  /**
   * Replaces the join link, invalidating the old one.
   *
   * **The only control over who can use it.** Anyone holding the link joins immediately, so a
   * link that reached the wrong person is dealt with by replacing it and removing whoever got
   * in. Students already enrolled are unaffected — the token is how you *join*, not how you
   * stay.
   */
  regenerateJoinToken: courseProcedure.mutation(async ({ ctx, input }) => {
    return ctx.db.course.update({
      where: { id: input.courseId },
      data: { joinToken: newJoinToken() },
      select: { id: true, joinToken: true },
    });
  }),

  // =====================================================================================
  // Co-teaching: who else may teach this cohort
  //
  // A second link, deliberately not the join link, because the two grant opposite things.
  // The join link admits a stranger to one cohort as a student; this one admits them to
  // authoring, to the gradebook, and to every student's grade in it.
  //
  // **It grants a course, never a role.** Only an account that already holds INSTRUCTOR or
  // ADMIN can redeem it. A student opening it is refused and told what is actually needed,
  // rather than promoted — a course-level link that made somebody staff would be a second
  // path to staff access with no admin involved, which is exactly what `adminProcedure` and
  // `InstructorInvite` exist to control. So becoming staff stays where it was, and this
  // decides only which cohorts an existing instructor works in.
  //
  // Reusable rather than single use, unlike an instructor invitation. A cohort gains
  // co-teachers one at a time across a term and the sender is the same person either way;
  // what bounds this link is the role check rather than the token being spent, and
  // `regenerateCoTeachToken` is the control over a link that reached the wrong person.
  // =====================================================================================

  /**
   * What a co-teach link points at, before anybody redeems it.
   *
   * `profileProcedure`, because the caller is by definition not yet an instructor of this
   * course — that is what they are here to change. Returns null on an unknown token so a
   * replaced link reads as "this link no longer works" rather than as an error page.
   *
   * It reports `eligible` rather than refusing, so the screen can explain the one refusal
   * that has an answer: a student account cannot be made staff from here, and saying so on
   * arrival beats a failed button.
   */
  previewCoTeach: profileProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUnique({
        where: { coTeachToken: input.token },
        select: {
          id: true,
          name: true,
          cohortTerm: true,
          archivedAt: true,
          instructors: {
            where: { isPrimary: true },
            take: 1,
            select: { user: { select: { displayName: true } } },
          },
        },
      });

      if (!course) return null;

      const already = await ctx.db.courseInstructor.findUnique({
        where: { courseId_userId: { courseId: course.id, userId: ctx.profile.id } },
        select: { id: true },
      });

      return {
        courseId: course.id,
        name: course.name,
        cohortTerm: course.cohortTerm,
        archived: course.archivedAt !== null,
        primaryInstructor: course.instructors[0]?.user.displayName ?? null,
        /** Whether this account may hold the grant at all — staff only. */
        eligible: ctx.profile.role === "INSTRUCTOR" || ctx.profile.role === "ADMIN",
        /** So the screen says "you already teach this" rather than offering to join again. */
        alreadyTeaches: already !== null,
      };
    }),

  /**
   * Redeems a co-teach link, adding the caller to the course as an instructor.
   *
   * **Idempotent**, the same way `enrollments.join` is and for the same reason:
   * `@@unique([courseId, userId])` means a second redemption returns the row that exists
   * rather than adding another, so a bookmarked link is not a case to handle.
   *
   * `isPrimary: false`, always. The primary instructor is whoever created the cohort, and
   * that is a fact about how the course came to exist rather than a rank a link can confer.
   */
  acceptCoTeach: profileProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUnique({
        where: { coTeachToken: input.token },
        select: { id: true, name: true, archivedAt: true },
      });

      /*
        The same message whether the link was never real or has been replaced. From here they
        are the same fact, and telling them apart would say something about a course the caller
        has no connection to.
      */
      if (!course) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "That co-teaching link does not work. It may have been replaced — ask whoever " +
            "sent it for the current one.",
        });
      }

      /*
        A student is refused rather than promoted, and told what would actually help.

        This is the guard the whole design rests on. Raising a role here would mean any
        instructor could hand out staff access to anybody by forwarding a course link, with no
        admin involved and no record of it beyond a `CourseInstructor` row.
      */
      if (ctx.profile.role !== "INSTRUCTOR" && ctx.profile.role !== "ADMIN") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            `This link adds an instructor to ${course.name}, and your account is not an ` +
            `instructor account. An admin has to send you an instructor invitation first — ` +
            `once you have used that, this link will work.`,
        });
      }

      if (course.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${course.name} is archived, so it is not taking new instructors.`,
        });
      }

      /*
        An enrolled student of this course is refused, the mirror of `enrollments.join`
        refusing an instructor. Being both would put their own submissions in the queue they
        are meant to be working through.
      */
      const enrolled = await ctx.db.enrollment.findUnique({
        where: { courseId_studentId: { courseId: course.id, studentId: ctx.profile.id } },
        select: { id: true },
      });
      if (enrolled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `You are enrolled as a student in ${course.name}, so you cannot also teach it. ` +
            `Ask an instructor to remove your enrollment first.`,
        });
      }

      const existing = await ctx.db.courseInstructor.findUnique({
        where: { courseId_userId: { courseId: course.id, userId: ctx.profile.id } },
        select: { id: true },
      });

      if (existing) {
        return { courseId: course.id, name: course.name, added: false };
      }

      await ctx.db.courseInstructor.create({
        data: { courseId: course.id, userId: ctx.profile.id, isPrimary: false },
        select: { id: true },
      });

      return { courseId: course.id, name: course.name, added: true };
    }),

  /**
   * Replaces the co-teach link, invalidating the old one.
   *
   * The only control over who can use it, exactly as with the join link: anybody holding it
   * who is already staff is added immediately, so a link that reached the wrong person is
   * dealt with by replacing it and removing whoever got in. Instructors already on the course
   * are unaffected — the token is how you are added, not how you stay.
   */
  regenerateCoTeachToken: courseProcedure.mutation(async ({ ctx, input }) => {
    return ctx.db.course.update({
      where: { id: input.courseId },
      data: { coTeachToken: newJoinToken() },
      select: { id: true, coTeachToken: true },
    });
  }),

  /**
   * Removes an instructor from a course.
   *
   * **Refused if it would leave the course with none**, the same shape and the same reasoning
   * as revoking the last admin: a course with no instructors is unreachable by every
   * authoring procedure, all of which check `CourseInstructor` rather than the role, and the
   * only way back is a database edit. The check is cheap and the failure is not.
   *
   * **The owner cannot be removed by anybody else**, which is the permission this whole area
   * exists for: before it, anybody who taught a course could remove the person who set it up.
   * They can still remove *themselves* — somebody who leaves the program should not be
   * permanent, and refusing would make "who created this" outrank "who runs it now" — and
   * ownership then falls to the longest-serving instructor left. `transferOwnership` is how
   * they choose who instead of letting the rule choose.
   *
   * Nothing is taken back on GitHub. An instructor removed here stays a collaborator on every
   * repository generated while they taught, because `accept` adds collaborators at the moment
   * a student accepts and those repositories hold real student work. Same reasoning as leaving
   * student repositories alone when an assignment is removed.
   */
  removeInstructor: courseProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      /*
        Every instructor on the course in one read, rather than the target row and a count.
        Three of the four things decided below — who the target is, whether this would empty
        the list, and who owns the cohort — are questions about the same set, and asking
        separately is how two of them come to be answered about different sets.
      */
      const instructors = await ctx.db.courseInstructor.findMany({
        where: { courseId: input.courseId },
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
          message: "That person does not teach this course.",
        });
      }

      if (instructors.length <= 1) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This is the only instructor on the course. Add another one first — a course " +
            "with no instructors cannot be authored in or graded, and only a database edit " +
            "would bring it back.",
        });
      }

      /*
        The owner is removable by the owner and by an admin, and by nobody else.

        Leaving on your own account is a decision about your own work; removing the person who
        runs a cohort is a decision about theirs. An admin passes because an admin is the
        recovery path when an owner has left the program without handing the course on.
      */
      const owner = ownerOf(instructors);
      const callerIsOwner = owner?.userId === ctx.profile.id;

      if (
        owner &&
        owner.userId === input.userId &&
        !callerIsOwner &&
        ctx.profile.role !== "ADMIN"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            `${displayNameOf(row.user, "that instructor")} owns this cohort, so only they can leave it. If they ` +
            `should hand it on, they can transfer it to somebody else first.`,
        });
      }

      await ctx.db.courseInstructor.delete({ where: { id: row.id } });

      /*
        Who owns it now, said back rather than left to be noticed.

        An owner who leaves without transferring hands the cohort to the longest-serving
        instructor left, by the same rule that covers a deleted account. It is the right
        default and it is not a thing anybody would guess, so the screen says whose it is now.
      */
      const remaining = instructors.filter((instructor) => instructor.id !== row.id);
      const successor = owner?.userId === input.userId ? ownerOf(remaining) : null;

      return {
        courseId: input.courseId,
        instructorName: displayNameOf(row.user, "that instructor"),
        /** Who inherited the cohort, or null when the person removed did not own it. */
        newOwnerName: successor ? displayNameOf(successor.user, "that instructor") : null,
      };
    }),

  /**
   * Hands the cohort to another of its instructors.
   *
   * **What makes "the owner cannot be removed" livable.** Without it that rule reads as "the
   * person who set this up runs it forever", and somebody leaving the program leaves behind a
   * cohort nobody else can take responsibility for. Leaving afterwards is then the ordinary
   * `removeInstructor` they already have.
   *
   * The target has to teach the course already. Ownership decides which of a cohort's
   * instructors can archive it and remove people, so handing it to somebody who is not one of
   * them would be adding an instructor by a second path — and the co-teaching link is the one
   * place that decision is made and explained.
   *
   * Cleared and then set, inside a transaction, because a partial unique index on
   * `course_instructors` allows exactly one primary row per course and is checked per
   * statement. Setting first would collide with the row being replaced.
   */
  transferOwnership: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsCourse(ctx, input.courseId, "hand on");

      const target = await ctx.db.courseInstructor.findUnique({
        where: { courseId_userId: { courseId: input.courseId, userId: input.userId } },
        select: {
          id: true,
          isPrimary: true,
          user: { select: personNameSelect },
        },
      });

      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "That person does not teach this course, so they cannot own it. Send them the " +
            "co-teaching link first.",
        });
      }

      if (target.isPrimary) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${displayNameOf(target.user, "that instructor")} already owns this cohort.`,
        });
      }

      await ctx.db.$transaction(async (tx) => {
        await tx.courseInstructor.updateMany({
          where: { courseId: input.courseId, isPrimary: true },
          data: { isPrimary: false },
        });
        await tx.courseInstructor.update({
          where: { id: target.id },
          data: { isPrimary: true },
        });
      });

      return {
        courseId: input.courseId,
        ownerId: input.userId,
        ownerName: displayNameOf(target.user, "that instructor"),
      };
    }),
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
      gradingDrafts: {
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
  // assignment at all is a property of the assignment, and a cohort of twenty-five turns that
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
      bucket: triageBucket(
        submission.status,
        draft,
        draftIsStale,
        undeliveredIds.has(submission.id),
        manualOnlyByAssignment.get(submission.assignmentId) ?? false,
      ),
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
    select: { id: true, name: true, cohortTerm: true, cohortSlug: true, archivedAt: true },
  });

  if (!course) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });
  }

  await assertOwnsCourse(ctx, courseId, action);

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
