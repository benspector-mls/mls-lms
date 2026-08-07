import Link from 'next/link';
import { Archive, ArrowRight, BookOpen, UserMinus } from 'lucide-react';

import { NewCourseDialog } from '@/components/instructor/new-course-dialog';
import { EmptyState } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { courseHref } from '@/lib/links';
import { cn } from '@/lib/utils';

/**
 * The courses the caller belongs to. Students and instructors see the same card, and it
 * opens into whichever view the caller works in — the instructor screens for a course they
 * teach, the student's own assignments otherwise.
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
  enrolledAs: 'ACTIVE' | 'REMOVED' | null;
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
              Accepting an assignment creates a repository named after your GitHub
              username, so you need to sign in with GitHub at least once first. Sign out,
              then choose &ldquo;Sign in with GitHub&rdquo;.
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
        <div className="flex flex-col gap-3">
          {courses.map((course) => {
            const archived = course.archivedAt != null;
            const removed = course.enrolledAs === 'REMOVED';

            return (
              <Card key={course.id} className={cn((archived || removed) && 'opacity-80')}>
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
                        {course.cohortTerm} · {course._count.assignments}{' '}
                        {course._count.assignments === 1 ? 'assignment' : 'assignments'} ·{' '}
                        {course._count.enrollments}{' '}
                        {course._count.enrollments === 1 ? 'student' : 'students'}
                      </p>
                      {removed && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Your work and the feedback you were given stay available here. You
                          cannot hand in anything new.
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
          })}
        </div>
      )}
    </div>
  );
}
