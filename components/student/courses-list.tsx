import Link from "next/link";
import { Archive, ArrowRight, BookOpen, CircleCheck, UserMinus } from "lucide-react";

import { NewCourseDialog } from "@/components/instructor/new-course-dialog";
import { EmptyState } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { courseHref } from "@/lib/links";
import { cn } from "@/lib/utils";

/**
 * The courses the caller belongs to. Students and instructors see the same card, and it
 * opens into whichever view the caller works in — the instructor screens for a course they
 * teach, the student's own assignments otherwise.
 *
 * **This is the only screen that is not scoped to a cohort**, which is why archived ones belong
 * here. They are in a section beneath the running ones rather than mixed in: a finished term is
 * not something anybody is working in, and a list that made no distinction would put last year
 * beside this week.
 *
 * There is deliberately no second link offering an instructor the student view of their own
 * course. It would show them their own submissions, which do not exist, rather than what a
 * student sees — that needs [a test enrollment](../../ROADMAP.md#seeing-a-course-as-a-student-sees-it).
 */

type Course = {
  id: string;
  name: string;
  cohortTerm: string;
  archivedAt: Date | null;
  teaches: boolean;
  /**
   * The caller's own enrollment status, or null when they are not a student of this course.
   *
   * `REMOVED` is why this is here. A student who has left a cohort keeps the course — they can
   * still read the feedback they were given — and a card that looked identical to the cohorts
   * they are still in would be telling them something false.
   */
  enrolledAs: "ACTIVE" | "REMOVED" | null;
  /**
   * Where the caller stands on the whole course, or null when they are not a student of it.
   *
   * The top of one rule applied at three levels: an assignment is complete when it is marked so,
   * a unit when every published assignment in it is, a course when every unit that has a verdict
   * is. Computed in `courses.listMine` by the same function the gradebook reads, so a student and
   * their instructor are never shown different answers.
   */
  completion: "complete" | "incomplete" | "pending" | null;
  _count: { assignments: number; enrollments: number };
};

export function CoursesList({
  courses,
  githubLinked,
  canCreate,
}: {
  courses: Course[];
  githubLinked: boolean;
  /**
   * Whether to offer creating one. Any instructor may — a cohort belongs to whoever runs it —
   * and the procedure is what refuses, so this only decides whether the button is there.
   */
  canCreate: boolean;
}) {
  const running = courses.filter((course) => course.archivedAt == null);
  const archived = courses.filter((course) => course.archivedAt != null);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Courses"
        description="The cohorts you belong to."
        actions={canCreate ? <NewCourseDialog courses={courses} /> : undefined}
      />

      {/*
        Worth saying before they try. Accepting an assignment creates a repository named
        after the GitHub username, so without one the button fails at the point of use
        with an error rather than here with an instruction.
      */}
      {!githubLinked && (
        <Card className="border-amber-500/50">
          <CardContent className="py-4 text-sm">
            <p className="font-medium">Your GitHub account is not linked</p>
            <p className="mt-1 text-muted-foreground">
              Accepting an assignment creates a repository named after your GitHub username, so you
              need to sign in with GitHub at least once first. Sign out, then choose &ldquo;Sign in
              with GitHub&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}

      {courses.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title="You are not enrolled in any courses yet"
          description="When you are added to a cohort, it will appear here."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {running.length > 0 ? (
            <div className="flex flex-col gap-3">
              {running.map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>
          ) : (
            /*
              Said rather than left as an empty page above a list. Everything the caller
              belongs to being archived is a real state — the term between two cohorts — and
              a screen showing only the archived section reads as a bug otherwise.
            */
            <EmptyState
              icon={<Archive />}
              title="Nothing running right now"
              description="Every cohort you belong to has been archived. They are below, and they stay readable."
            />
          )}

          {archived.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5 border-t border-border pt-5">
                <h2 className="text-sm font-medium">Archived</h2>
                <p className="text-xs text-muted-foreground">
                  Finished cohorts. Everything in them stays readable — the work, the grades, and
                  the feedback that was given — and nothing new can be handed in.
                </p>
              </div>
              {archived.map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function CourseCard({ course }: { course: Course }) {
  const archived = course.archivedAt != null;
  const removed = course.enrolledAs === "REMOVED";

  return (
    <Card className={cn((archived || removed) && "opacity-80")}>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BookOpen className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-balance text-foreground">
                {course.name}
              </h2>
              {archived && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <Archive className="size-3" />
                  Archived
                </span>
              )}
              {/*
                Whether the caller has finished this course.

                **Only the "complete" state is shown.** A course is complete when every unit that
                has anything published in it is complete, so the other two verdicts are the
                ordinary condition of a term in progress — a badge reading "Not finished" on every
                card of a running cohort would be a label on the normal case, which is noise. The
                green is the same green completion uses everywhere else in the interface.

                Absent entirely for an instructor's own cohorts, because they are not doing the
                work: `completion` is null unless the caller is enrolled.
              */}
              {course.completion === "complete" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <CircleCheck className="size-3" />
                  Complete
                </span>
              )}
              {/*
                Said on the card rather than only inside the course, because this is
                where somebody would otherwise be misled: a cohort they have left,
                sitting in the same list as the ones they are in.
              */}
              {removed && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <UserMinus className="size-3" />
                  No longer enrolled
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {course.cohortTerm} · {course._count.assignments}{" "}
              {course._count.assignments === 1 ? "assignment" : "assignments"} ·{" "}
              {course._count.enrollments} {course._count.enrollments === 1 ? "student" : "students"}
            </p>
            {removed && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Your work and the feedback you were given stay available here. You cannot hand in
                anything new.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {/*
            One link, to the view the caller actually works in. An instructor
            opening a course wants their own screen — the roster, the assignments,
            the gradebook — and the student view of a course they teach shows them
            their own submissions, of which they have none.

            `teaches` rather than the role: an admin teaches no course and an
            instructor may be enrolled in one somebody else runs.
          */}
          <Link
            href={course.teaches ? courseHref(course.id) : `/courses/${course.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            Open course
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
