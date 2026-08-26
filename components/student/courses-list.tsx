import Link from "next/link";
import { Archive, ArrowRight, BookOpen, CircleCheck, UserMinus } from "lucide-react";

import { EmptyState } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { courseHref } from "@/lib/links";
import { cn } from "@/lib/utils";

/**
 * The courses the caller belongs to. Fellows and instructors see the same card, and it opens into
 * whichever view the caller works in — the instructor screens for a course they teach, the fellow's
 * own assignments otherwise.
 *
 * **A fellow's way around**, and for an instructor the sibling of `/programs`: this lists courses
 * across every program, that one lists the programs themselves. Archived courses belong
 * here for the same reason, in a section beneath the running ones rather than mixed in — a finished
 * course is not something anybody is working in, and a list that made no distinction would put last
 * year beside this week.
 *
 * **Creating a course is not offered here.** A course belongs to one program, so it is made
 * from that program's settings screen, where the term it will belong to is already decided.
 * A button here would have had to ask which program first, which is the question `/programs`
 * already answers by being the screen somebody was on.
 *
 * There is deliberately no second link offering an instructor the fellow's view of their own
 * course. It would show them their own submissions, which do not exist, rather than what a fellow
 * sees — that needs [a test enrollment](../../ROADMAP.md#seeing-a-course-as-a-student-sees-it).
 */

type Course = {
  id: string;
  name: string;
  /** The program the course belongs to, which is what tells two years of one course apart. */
  program: { name: string; term: string };
  archivedAt: Date | null;
  teaches: boolean;
  /**
   * The caller's own enrollment status, or null when they are not a student of this course.
   *
   * `REMOVED` is why this is here. A fellow who has left a program keeps its courses — they can
   * still read the feedback they were given — and a card that looked identical to the courses they
   * are still in would be telling them something false.
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
  _count: { assignments: number };
  /** How many active fellows are on the roster of the program this course belongs to. */
  rosterCount: number;
};

export function CoursesList({
  courses,
  githubLinked,
}: {
  courses: Course[];
  githubLinked: boolean;
}) {
  const running = courses.filter((course) => course.archivedAt == null);
  const archived = courses.filter((course) => course.archivedAt != null);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Courses" description="The courses you belong to." />

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
          description="When you are added to a program, its courses will appear here."
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
              belongs to being archived is a real state — the months between two programs —
              and a screen showing only the archived section reads as a bug otherwise.
            */
            <EmptyState
              icon={<Archive />}
              title="Nothing running right now"
              description="Every course you belong to has been archived. They are below, and they stay readable."
            />
          )}

          {archived.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5 border-t border-border pt-5">
                <h2 className="text-sm font-medium">Archived</h2>
                <p className="text-xs text-muted-foreground">
                  Finished courses. Everything in them stays readable — the work, the grades, and
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
                card of a running course would be a label on the normal case, which is noise. The
                green is the same green completion uses everywhere else in the interface.

                Absent entirely for an instructor's own courses, because they are not doing the
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
                where somebody would otherwise be misled: a program they have left,
                sitting in the same list as the ones they are in.
              */}
              {removed && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <UserMinus className="size-3" />
                  No longer enrolled
                </span>
              )}
            </div>
            {/*
              The program's name and not only the term, because a school runs several programs a year
              and "Fall 2026" alone would not say which of them this course belongs to. The roster
              count is the program's — one roster serves every course in it, which is the whole
              point of the program owning it.
            */}
            <p className="mt-0.5 text-sm text-muted-foreground">
              {course.program.name} · {course.program.term} · {course._count.assignments}{" "}
              {course._count.assignments === 1 ? "assignment" : "assignments"} ·{" "}
              {course.rosterCount} {course.rosterCount === 1 ? "fellow" : "fellows"}
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
            opening a course wants their own screen — the triage, the curriculum,
            the gradebook — and the fellow's view of a course they teach shows them
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
