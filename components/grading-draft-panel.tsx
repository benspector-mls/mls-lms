'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { ReportMarkdown } from '@/components/report-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTRPC } from '@/trpc/client';

/**
 * AI grading drafts for one submission.
 *
 * Two things this interface has to get right, because both are easy to get wrong in a
 * way that quietly misleads an instructor.
 *
 * **The report is shown as raw markdown, deliberately.** It is the exact text that
 * gets posted as a pull request comment on approval. Rendering it by default would hide
 * markdown that does not render, and broken markdown in a report is a defect an
 * instructor needs to see rather than have the browser paper over. A Preview toggle
 * shows the rendered form using the same component the student's page uses, so the two
 * cannot drift apart.
 *
 * **A section graded without test evidence is labelled as such.** Nothing constrains a
 * claimed score where there are no results to compare it against, so presenting a
 * verified section and an unverified one with the same authority would be misleading.
 */

type RubricItem = {
  label: string;
  criterion: string;
  scoreEarned: number;
  scorePossible: number;
  note: string | null;
};

type DraftSection = {
  id: string;
  sectionType: string;
  reportMarkdown: string | null;
  scoreEarned: number | null;
  scorePossible: number | null;
  rubricItems: unknown;
  flags: string[];
  instructorNotes: string[];
  confidence: string | null;
  submissionProcessNote: string | null;
  editedReportMarkdown: string | null;
  editedScoreEarned: number | null;
  editedAt: Date | null;
};

type Draft = {
  id: string;
  headSha: string;
  status: string;
  errorDetail: string | null;
  modelMetadata: unknown;
  createdAt: Date;
  approvedAt: Date | null;
  postedPrCommentId: bigint | null;
  sections: DraftSection[];
};

export function GradingDraftPanel({ submissionId }: { submissionId: string }) {
  const trpc = useTRPC();
  const [showOlder, setShowOlder] = useState(false);

  const drafts = useQuery(trpc.gradingDrafts.listForSubmission.queryOptions({ submissionId }));
  const generate = useMutation(
    trpc.gradingDrafts.generate.mutationOptions({ onSuccess: () => drafts.refetch() }),
  );

  if (drafts.isPending) {
    return <p className="text-sm text-muted-foreground">Loading drafts…</p>;
  }
  if (drafts.error) {
    return (
      <p className="text-sm text-red-500" role="alert">
        {drafts.error.message}
      </p>
    );
  }

  const data = drafts.data;
  if (!data) return null;

  const latest = data.drafts[0];
  // Approved drafts are rounds of feedback the student received, and they accumulate
  // on purpose: read in order they show what changed between attempts. Collapsed by
  // default, never discarded.
  const approvedCount = data.drafts.filter((draft) => draft.approvedAt !== null).length;

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {data.canGenerate ? (
            <Button
              onClick={() => generate.mutate({ submissionId })}
              disabled={generate.isPending}
              size="sm"
              variant="outline"
            >
              {generate.isPending
                ? 'Writing report…'
                : latest
                  ? 'Regenerate report'
                  : 'Generate report'}
            </Button>
          ) : (
            // Absent rather than disabled: the reason is specific and actionable, and
            // a greyed-out control invites clicking without saying why it won't work.
            <span className="text-sm text-muted-foreground">{data.blockedReason}</span>
          )}
          {generate.isPending && (
            <span className="text-xs text-muted-foreground">this takes a minute</span>
          )}
        </div>

        {data.drafts.length > 1 && (
          <button
            type="button"
            onClick={() => setShowOlder(!showOlder)}
            className="text-xs underline underline-offset-4"
          >
            {showOlder
              ? 'Hide earlier drafts'
              : `Show all ${data.drafts.length} drafts` +
                (approvedCount > 1 ? ` (${approvedCount} rounds of feedback)` : '')}
          </button>
        )}
      </div>

      {generate.error && (
        <p className="text-sm text-red-500" role="alert">
          {generate.error.message}
        </p>
      )}

      {!latest && data.canGenerate && (
        <p className="text-sm text-muted-foreground">No report has been generated yet.</p>
      )}

      {data.grade?.gradedAt && (
        <GradeSummary submissionId={submissionId} grade={data.grade} onChanged={() => drafts.refetch()} />
      )}

      {latest && (
        <>
          <DraftView
            draft={latest}
            currentHeadSha={data.currentHeadSha}
            onEdited={() => drafts.refetch()}
          />
          <ApproveControl
            draft={latest}
            currentHeadSha={data.currentHeadSha}
            alreadyGraded={Boolean(data.grade?.gradedAt)}
            onApproved={() => drafts.refetch()}
          />
        </>
      )}

      {showOlder &&
        data.drafts.slice(1).map((draft) => (
          <div key={draft.id} className="opacity-60">
            <DraftView draft={draft} currentHeadSha={data.currentHeadSha} />
          </div>
        ))}
    </div>
  );
}

type Grade = {
  finalScore: number | null;
  finalScorePossible: number | null;
  isComplete: boolean | null;
  gradedAt: Date | null;
  gradedHeadSha: string | null;
  /** False when the most recent approval's comment never reached GitHub. */
  commentPosted: boolean;
};

/**
 * The grade on record, and whether the student actually received it.
 *
 * The second half is the reason this exists. Approving writes the grade and posts the
 * comment as two separate steps, so a GitHub outage leaves a correct grade that no
 * student has seen. That state is recoverable, but only if an instructor can tell it
 * apart from a normal one.
 */
function GradeSummary({
  submissionId,
  grade,
  onChanged,
}: {
  submissionId: string;
  grade: Grade;
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const retry = useMutation(
    trpc.gradingDrafts.retryComment.mutationOptions({ onSuccess: onChanged }),
  );

  const posted = grade.commentPosted;

  return (
    <div className="rounded border bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>graded</Badge>
        <span className="font-medium">
          {grade.finalScore}/{grade.finalScorePossible}
        </span>
        {grade.isComplete !== null && (
          <Badge variant={grade.isComplete ? 'secondary' : 'destructive'}>
            {grade.isComplete ? 'complete' : 'below threshold'}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {grade.gradedAt?.toLocaleString()}
          {grade.gradedHeadSha && ` · ${grade.gradedHeadSha.slice(0, 7)}`}
        </span>
      </div>

      {!posted && (
        <div className="mt-2 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
          <p className="font-medium">The grade is recorded, but no comment was posted.</p>
          <p className="mt-1">
            The student can see this on their own assignment page. Nothing has appeared on
            the pull request.
          </p>
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ submissionId })}
          >
            {retry.isPending ? 'Posting…' : 'Post the comment now'}
          </Button>
          {retry.error && (
            <p className="mt-1 text-red-500" role="alert">
              {retry.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Approving is the only irreversible, outward-facing action in this interface: it
 * records the grade and puts text in front of a student. So it asks twice, and the
 * second button says what will happen rather than "confirm".
 */
function ApproveControl({
  draft,
  currentHeadSha,
  alreadyGraded,
  onApproved,
}: {
  draft: Draft;
  currentHeadSha: string | null;
  alreadyGraded: boolean;
  onApproved: () => void;
}) {
  const trpc = useTRPC();
  const [confirming, setConfirming] = useState(false);
  const approve = useMutation(
    trpc.gradingDrafts.approve.mutationOptions({
      onSuccess: () => {
        setConfirming(false);
        onApproved();
      },
    }),
  );

  // A draft with no report cannot be posted, and one describing an older commit would
  // attach a report to code nobody read. The server refuses both; saying so here means
  // the instructor is not told only after clicking.
  const stale = currentHeadSha !== null && draft.headSha !== currentHeadSha;
  const blocked =
    draft.approvedAt !== null
      ? 'This draft has already been sent to the student.'
      : draft.status === 'FAILED' || draft.status === 'GENERATING'
        ? 'This draft has no report to post.'
        : draft.status === 'SUPERSEDED'
          ? 'This draft was superseded by a newer commit.'
          : stale
            ? 'Regenerate first — this draft describes an older commit.'
            : null;

  if (blocked) return <p className="text-xs text-muted-foreground">{blocked}</p>;

  return (
    <div className="flex flex-col gap-2">
      {!confirming ? (
        <Button size="sm" className="self-start" onClick={() => setConfirming(true)}>
          {alreadyGraded ? 'Approve this draft and update the grade' : 'Approve and post to GitHub'}
        </Button>
      ) : (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium">
            This posts the report above to the pull request, where the student will read
            it, and records the score as their grade.
          </p>
          {draft.status === 'NEEDS_MANUAL_REVIEW' && (
            <p className="mt-1">
              This draft was held for review. Approving it accepts the report as written.
            </p>
          )}
          {alreadyGraded && (
            <p className="mt-1">
              The existing comment will be edited rather than a second one added.
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={approve.isPending}
              onClick={() => approve.mutate({ draftId: draft.id })}
            >
              {approve.isPending ? 'Posting…' : 'Post it'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={approve.isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {approve.error && (
        <p className="text-sm text-red-500" role="alert">
          {approve.error.message}
        </p>
      )}
      {approve.data?.commentError && (
        <p className="text-xs text-amber-600" role="alert">
          Grade recorded, but the comment failed to post: {approve.data.commentError}
        </p>
      )}
    </div>
  );
}

function DraftView({
  draft,
  currentHeadSha,
  onEdited,
}: {
  draft: Draft;
  currentHeadSha: string | null;
  onEdited?: () => void;
}) {
  const metadata = isRecord(draft.modelMetadata) ? draft.modelMetadata : null;
  const usage = metadata && isRecord(metadata.usage) ? metadata.usage : null;
  const stale = currentHeadSha !== null && draft.headSha !== currentHeadSha;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(draft.status)}>{draft.status.replace(/_/g, ' ')}</Badge>
        {draft.approvedAt && (
          <span className="text-xs text-muted-foreground">
            sent to the student {draft.approvedAt.toLocaleDateString()}
            {draft.postedPrCommentId === null && ' — comment never posted'}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {draft.headSha.slice(0, 7)}
          {typeof metadata?.provider === 'string' && ` · ${metadata.provider}`}
          {typeof usage?.promptTokens === 'number' &&
            ` · ${usage.promptTokens} in / ${usage.completionTokens} out`}
          {typeof usage?.cachedPromptTokens === 'number' &&
            usage.cachedPromptTokens > 0 &&
            ` (${usage.cachedPromptTokens} cached)`}
        </span>
      </div>

      {/*
        A draft against an older commit is not wrong, but it describes different code.
        Worth saying plainly rather than letting a stale score be read as current.
      */}
      {stale && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
          This draft describes commit <code>{draft.headSha.slice(0, 7)}</code>, but the pull
          request is now at <code>{currentHeadSha?.slice(0, 7)}</code>. Regenerate before
          approving.
        </div>
      )}

      {/*
        The reasons an instructor has to look. Not a failure — the pipeline routing a
        draft here is it working correctly.
      */}
      {draft.status === 'NEEDS_MANUAL_REVIEW' && draft.errorDetail && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-2">
          <p className="font-medium">Needs your judgment</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {draft.errorDetail.split('\n').map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {draft.status === 'FAILED' && (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-2">
          <p className="font-medium">Could not produce a report</p>
          <p className="mt-1 text-xs">{draft.errorDetail ?? 'No detail recorded.'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No score was recorded. Grade this one by hand, or fix the cause and regenerate.
          </p>
        </div>
      )}

      {draft.sections.map((section) => (
        <SectionView
          key={section.id}
          section={section}
          // An approved draft is feedback the student has already read. Editing it
          // would change the record of what they were told without changing what they
          // saw, so revising means a new report.
          editable={draft.approvedAt === null && onEdited !== undefined}
          onEdited={onEdited ?? (() => {})}
        />
      ))}
    </div>
  );
}


/**
 * One section, reviewable and editable.
 *
 * The report stays raw here while the student's view renders it. That is not an
 * oversight: an instructor is deciding whether to send this text, and markdown that
 * does not render is a defect they need to see rather than have the browser paper
 * over. The Preview toggle shows exactly what the student will get, using the same
 * component their page uses, so the two cannot drift.
 *
 * An edit is stored beside the model's output, never over it. What gets posted is the
 * edit; what remains on record is both.
 */
function SectionView({
  section,
  editable,
  onEdited,
}: {
  section: DraftSection;
  editable: boolean;
  onEdited: () => void;
}) {
  const trpc = useTRPC();
  const [showReport, setShowReport] = useState(true);
  const [preview, setPreview] = useState(false);
  const [editing, setEditing] = useState(false);

  const effectiveMarkdown = section.editedReportMarkdown ?? section.reportMarkdown ?? '';
  const effectiveScore = section.editedScoreEarned ?? section.scoreEarned;

  const [draftText, setDraftText] = useState(effectiveMarkdown);
  const [draftScore, setDraftScore] = useState(String(effectiveScore ?? ''));

  const update = useMutation(
    trpc.gradingDrafts.updateSection.mutationOptions({
      onSuccess: () => {
        setEditing(false);
        onEdited();
      },
    }),
  );

  const rubricItems: RubricItem[] = Array.isArray(section.rubricItems)
    ? (section.rubricItems as RubricItem[])
    : [];

  // Written by the pipeline rather than the model, so the interface can distinguish a
  // section whose test claims were checked against a run from one that rests entirely
  // on the model's reading of the code.
  const verified = section.flags.includes('TEST_EVIDENCE');
  const otherFlags = section.flags.filter(
    (flag) => flag !== 'TEST_EVIDENCE' && flag !== 'NO_TEST_EVIDENCE',
  );

  // The number in the prose against the number that would be recorded. Approving
  // refuses when these disagree, so the warning belongs here, while it is still being
  // typed, rather than at the end.
  const statedInText = effectiveMarkdown.match(/^#{1,3}\s.*?Score:\s*([\d.]+)\s*\/\s*([\d.]+)/im);
  const textDisagrees =
    statedInText !== null &&
    (Number(statedInText[1]) !== effectiveScore ||
      Number(statedInText[2]) !== section.scorePossible);

  return (
    <div className="rounded border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{section.sectionType.replace(/_/g, ' ')}</span>
          <span>
            {effectiveScore}/{section.scorePossible}
            {section.scorePossible
              ? ` = ${Math.round(((effectiveScore ?? 0) / section.scorePossible) * 100)}%`
              : ''}
          </span>
          {section.editedAt && (
            <Badge variant="secondary" className="text-xs">
              edited by you
            </Badge>
          )}
          <Badge variant={verified ? 'secondary' : 'outline'} className="text-xs">
            {verified ? 'test claims verified' : 'no test evidence'}
          </Badge>
          {section.confidence === 'LOW' && (
            <Badge variant="destructive" className="text-xs">
              low confidence
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          {editable && !editing && (
            <button
              type="button"
              onClick={() => {
                setDraftText(effectiveMarkdown);
                setDraftScore(String(effectiveScore ?? ''));
                setEditing(true);
                setShowReport(true);
              }}
              className="text-xs underline underline-offset-4"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowReport(!showReport)}
            className="text-xs underline underline-offset-4"
          >
            {showReport ? 'Hide report' : 'Show report'}
          </button>
        </div>
      </div>

      {textDisagrees && (
        <p className="mt-1 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
          The report text says {statedInText?.[1]}/{statedInText?.[2]} but the score being
          recorded is {effectiveScore}/{section.scorePossible}. Approving is blocked until
          these agree — the student reads the report, the gradebook reads the score.
        </p>
      )}

      {!verified && (
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing automatic constrains this score — there were no test results to check it
          against. Read the code before approving.
        </p>
      )}

      {otherFlags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {otherFlags.map((flag, index) => (
            <Badge key={`${flag}:${index}`} variant="outline" className="text-xs">
              {flag}
            </Badge>
          ))}
        </div>
      )}

      {/*
        Written for the instructor and never posted to the student. Given room to
        breathe rather than squeezed into a badge, because these are the caveats that
        decide whether the score can be approved as it stands.
      */}
      {section.instructorNotes.length > 0 && (
        <div className="mt-2 rounded border border-dashed p-2">
          <p className="text-xs font-medium">The model&apos;s caveats — not shown to the student</p>
          <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
            {section.instructorNotes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {rubricItems.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs underline underline-offset-4">
            Score breakdown ({rubricItems.length} items)
          </summary>
          <ul className="mt-1 flex flex-col gap-1 text-xs">
            {rubricItems.map((item, index) => (
              <li key={`${item.label}:${index}`}>
                <span className="font-medium">
                  {item.scoreEarned}/{item.scorePossible}
                </span>{' '}
                {item.label} <span className="text-muted-foreground">({item.criterion})</span>
                {item.note && <span className="text-muted-foreground"> — {item.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {section.submissionProcessNote && (
        <p className="mt-2 text-xs text-muted-foreground">
          Process note: {section.submissionProcessNote}
        </p>
      )}

      {editing ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-xs font-medium">
            Score out of {section.scorePossible}
            <input
              type="number"
              step="0.5"
              min={0}
              max={section.scorePossible ?? undefined}
              value={draftScore}
              onChange={(event) => setDraftScore(event.target.value)}
              className="ml-2 w-24 rounded border bg-background px-2 py-1 text-sm"
            />
          </label>
          <textarea
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            rows={18}
            spellCheck
            className="w-full rounded border bg-background p-3 font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Change the score line in the text too if you change the score above.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={update.isPending || draftText.trim().length === 0}
              onClick={() =>
                update.mutate({
                  sectionId: section.id,
                  reportMarkdown: draftText,
                  scoreEarned: draftScore === '' ? null : Number(draftScore),
                })
              }
            >
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {section.editedAt && (
              // Discards the edit rather than undoing it stepwise, which is the only
              // sensible meaning of "revert" when the original is a stored column.
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({
                    sectionId: section.id,
                    reportMarkdown: null,
                    scoreEarned: null,
                  })
                }
              >
                Discard my edits
              </Button>
            )}
          </div>
          {update.error && (
            <p className="text-sm text-red-500" role="alert">
              {update.error.message}
            </p>
          )}
        </div>
      ) : (
        showReport &&
        effectiveMarkdown && (
          <>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {preview
                  ? 'Rendered as the student will see it.'
                  : 'Raw markdown — this is the exact text that gets posted.'}
              </p>
              <button
                type="button"
                onClick={() => setPreview(!preview)}
                className="text-xs underline underline-offset-4"
              >
                {preview ? 'Show raw markdown' : 'Preview'}
              </button>
            </div>
            {preview ? (
              <div className="mt-1 rounded border p-3">
                <ReportMarkdown>{effectiveMarkdown}</ReportMarkdown>
              </div>
            ) : (
              <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
                {effectiveMarkdown}
              </pre>
            )}
          </>
        )
      )}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'READY':
      return 'default';
    case 'APPROVED':
      return 'default';
    case 'GENERATING':
      return 'secondary';
    case 'FAILED':
      return 'destructive';
    default:
      return 'outline';
  }
}
