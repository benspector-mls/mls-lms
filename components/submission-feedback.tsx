'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ReportMarkdown } from '@/components/report-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTRPC } from '@/trpc/client';

/**
 * A student's own grade and feedback, plus the button that asks for another look.
 *
 * The feedback shown here is the same text posted to the pull request. It appears the
 * moment an instructor approves — there is no separate publish step — which also means
 * a student still sees their grade when the GitHub comment failed to post.
 *
 * Rendered, not raw. A student is reading feedback, not inspecting a document: headings
 * and checklists are how the report is meant to be read, and it is what they would see
 * on the pull request. The instructor's view keeps the raw text, because there the
 * markdown itself is under review.
 */

type FeedbackRound = {
  id: string;
  approvedAt: Date | null;
  headSha: string;
  sections: {
    sectionType: string;
    reportMarkdown: string | null;
    scoreEarned: number | null;
    scorePossible: number | null;
  }[];
};

type Submission = {
  id: string;
  status: string;
  finalScore: number | null;
  finalScorePossible: number | null;
  isComplete: boolean | null;
  feedbackMarkdown: string | null;
  gradedAt: Date | null;
  headSha: string | null;
  gradedHeadSha: string | null;
  /** Every round of feedback received, oldest first. */
  gradingDrafts: FeedbackRound[];
};

function sumScore(round: FeedbackRound): string {
  const earned = round.sections.reduce((total, s) => total + (s.scoreEarned ?? 0), 0);
  const possible = round.sections.reduce((total, s) => total + (s.scorePossible ?? 0), 0);
  return `${earned}/${possible}`;
}

export function SubmissionFeedback({ submission }: { submission: Submission }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [showReport, setShowReport] = useState(false);

  const declare = useMutation(
    trpc.submissions.declareResubmission.mutationOptions({
      onSuccess: () => router.refresh(),
    }),
  );

  if (!submission.gradedAt) return null;

  // Newer code exists than what was graded. A fact, not a prompt — a student pushing
  // commits is ordinary, and this only becomes a request for re-review when they say
  // so below.
  const revised =
    submission.headSha !== null &&
    submission.gradedHeadSha !== null &&
    submission.headSha !== submission.gradedHeadSha;

  const awaitingReview = submission.status === 'RESUBMITTED';

  // Everything but the most recent round, which is already shown above as the current
  // grade. Ordered oldest first, so "Round 1" is the first attempt.
  const earlierRounds = submission.gradingDrafts.slice(0, -1);

  return (
    <div className="flex flex-col gap-2 rounded border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {submission.finalScore}/{submission.finalScorePossible}
        </span>
        {submission.isComplete !== null && (
          <Badge variant={submission.isComplete ? 'secondary' : 'outline'}>
            {submission.isComplete ? 'complete' : 'not yet complete'}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          graded {submission.gradedAt.toLocaleDateString()}
        </span>
        <button
          type="button"
          onClick={() => setShowReport(!showReport)}
          className="text-xs underline underline-offset-4"
        >
          {showReport ? 'Hide feedback' : 'Read feedback'}
        </button>
      </div>

      {showReport && submission.feedbackMarkdown && (
        <div className="rounded border p-3">
          <ReportMarkdown>{submission.feedbackMarkdown}</ReportMarkdown>
        </div>
      )}

      {/*
        Earlier rounds, collapsed. Kept rather than replaced because feedback on a
        resubmission describes different work — reading the rounds in order is what
        shows what changed, and that is worth more to a student than either report on
        its own.
      */}
      {earlierRounds.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer underline underline-offset-4">
            Earlier feedback ({earlierRounds.length}{' '}
            {earlierRounds.length === 1 ? 'round' : 'rounds'})
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            {earlierRounds.map((round, index) => (
              <div key={round.id}>
                <p className="text-muted-foreground">
                  Round {index + 1} · {round.approvedAt?.toLocaleDateString()} ·{' '}
                  {sumScore(round)}
                </p>
                <div className="mt-1 rounded border p-3">
                  <ReportMarkdown>
                    {round.sections
                      .map((section) => section.reportMarkdown?.trim())
                      .filter(Boolean)
                      .join('\n\n---\n\n')}
                  </ReportMarkdown>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {awaitingReview && (
        <p className="text-xs text-muted-foreground">
          You have asked for another look. Your instructor will see this in their queue.
        </p>
      )}

      {revised && !awaitingReview && (
        <div className="rounded border border-dashed p-2 text-xs">
          <p>
            You have pushed commits since this was graded. When you are finished, let your
            instructor know it is ready — pushing on its own does not ask for another
            review.
          </p>
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            disabled={declare.isPending}
            onClick={() => declare.mutate({ submissionId: submission.id })}
          >
            {declare.isPending ? 'Sending…' : 'Ask for another review'}
          </Button>
          {declare.error && (
            <p className="mt-1 text-red-500" role="alert">
              {declare.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
