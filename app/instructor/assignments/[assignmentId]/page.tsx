import Link from 'next/link';
import { Suspense } from 'react';

import { GradingDraftPanel } from '@/components/grading-draft-panel';
import { TestRunPanel } from '@/components/test-run-panel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * Instructor view of every submission for one assignment.
 *
 * This is the one read that deliberately crosses students. Authorization happens
 * in the procedure, which checks that the caller teaches the course. It is not
 * done here, because a page component is not a security boundary.
 */
export default function AssignmentSubmissionsPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading submissions…</p>}>
        <SubmissionList params={params} />
      </Suspense>
    </main>
  );
}

async function SubmissionList({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;

  const { assignment, submissions } = await getQueryClient().fetchQuery(
    trpc.submissions.listForAssignment.queryOptions({ assignmentId }),
  );

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{assignment.title}</h1>
        <p className="text-sm text-muted-foreground">
          {submissions.length} submission{submissions.length === 1 ? '' : 's'}
          {assignment.dueAt && ` · due ${assignment.dueAt.toLocaleDateString()}`}
        </p>
        <Link
          href={`/courses/${assignment.courseId}`}
          className="text-sm underline underline-offset-4"
        >
          Back to assignments
        </Link>
      </div>

      {submissions.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nothing submitted yet</CardTitle>
            <CardDescription>
              A row appears here once a student accepts the assignment.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {submissions.map((submission) => (
        <Card key={submission.id}>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">
                  {submission.student.displayName ?? submission.student.email ?? 'Unknown student'}
                </CardTitle>
                <CardDescription>
                  {submission.student.githubUsername
                    ? `@${submission.student.githubUsername}`
                    : 'no GitHub account linked'}
                </CardDescription>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant="outline">{submission.status}</Badge>
                {submission.isLate && <Badge variant="destructive">late</Badge>}
                {/*
                  Two columns compared, no API call: the student has pushed code newer
                  than what was graded. Shown as a plain fact. It is not a request for
                  re-review — the RESUBMITTED status is that — because students commit
                  while they work and most of these need nothing from an instructor.
                */}
                {submission.gradedHeadSha &&
                  submission.headSha !== submission.gradedHeadSha && (
                    <Badge variant="secondary">revised since grading</Badge>
                  )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-1 text-sm">
            {submission.repoUrl && (
              <a
                href={submission.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                {submission.repoFullName}
              </a>
            )}

            {submission.prUrl && (
              <a
                href={submission.prUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                Pull request #{submission.prNumber}
              </a>
            )}

            {submission.submittedAt && (
              <p className="text-muted-foreground">
                Submitted {submission.submittedAt.toLocaleString()}
              </p>
            )}

            {submission.headSha && (
              <p className="text-muted-foreground">
                Latest commit {submission.headSha.slice(0, 7)}
              </p>
            )}

            <TestRunPanel submissionId={submission.id} />
            <GradingDraftPanel submissionId={submission.id} />
          </CardContent>
        </Card>
      ))}
    </>
  );
}
