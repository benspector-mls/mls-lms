import Link from 'next/link';
import { Suspense } from 'react';

import { AcceptAssignmentButton } from '@/components/accept-assignment-button';
import { SubmissionFeedback } from '@/components/submission-feedback';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * The params promise is passed down rather than awaited here, because awaiting it
 * in the page component would make the whole route block on per-request data,
 * which `cacheComponents` disallows outside a Suspense boundary.
 */
export default function CourseAssignmentsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Assignments</h1>
        <Link href="/courses" className="text-sm underline underline-offset-4">
          All courses
        </Link>
      </div>

      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading assignments…</p>}>
        <AssignmentList params={params} />
      </Suspense>
    </main>
  );
}

async function AssignmentList({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  const [profile, assignments] = await Promise.all([
    queryClient.fetchQuery(trpc.me.queryOptions()),
    queryClient.fetchQuery(trpc.assignments.listForCourse.queryOptions({ courseId })),
  ]);

  const isInstructor = profile?.role === 'INSTRUCTOR' || profile?.role === 'ADMIN';

  if (assignments.length === 0) {
    return <p className="text-sm text-muted-foreground">This course has no assignments yet.</p>;
  }

  return (
    <>
      {assignments.map((assignment) => {
        // listForCourse scopes the submissions relation to the caller, so this
        // array holds at most the caller's own submission.
        const submission = assignment.submissions[0];

        return (
          <Card key={assignment.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">{assignment.title}</CardTitle>
                  <CardDescription>
                    {assignment.moduleTag} · {assignment.pointValue} points
                    {assignment.dueAt && ` · due ${assignment.dueAt.toLocaleDateString()}`}
                  </CardDescription>
                </div>
                {submission && <Badge variant="outline">{submission.status}</Badge>}
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-3 text-sm">
              {submission?.repoUrl && (
                <a
                  href={submission.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  Open your repository
                </a>
              )}

              {submission?.prUrl && (
                <a
                  href={submission.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  Open your pull request{submission.isLate ? ' (submitted late)' : ''}
                </a>
              )}

              {!submission && profile?.role === 'STUDENT' && (
                <AcceptAssignmentButton assignmentId={assignment.id} />
              )}

              {submission && <SubmissionFeedback submission={submission} />}

              {submission?.status === 'ACCEPTED' && (
                <p className="text-muted-foreground">
                  Work on the <code>draft</code> branch, then open a pull request into{' '}
                  <code>main</code> and add your instructor as a reviewer.
                </p>
              )}

              {isInstructor && (
                <Link
                  href={`/instructor/assignments/${assignment.id}`}
                  className="underline underline-offset-4"
                >
                  View all submissions
                </Link>
              )}
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
