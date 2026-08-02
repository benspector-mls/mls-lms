import Link from 'next/link';
import type * as React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  Clock,
  FileClock,
  Inbox,
  Loader2,
  MessageSquareOff,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';

import { EmptyState } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { FlagBadge } from '@/components/status-badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { gradingQueueHref } from '@/lib/links';
import { flagMeta, formatRelative, scoreLabel } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { RouterOutputs } from '@/trpc/types';

/**
 * What is waiting on the instructor, across every course they teach.
 *
 * Organized by what to do about it rather than by course or assignment, because the
 * question this screen answers is "what next". A submission appears here only while it
 * needs a person; approving it is what takes it off the list.
 */

type Triage = RouterOutputs['submissions']['triage'];
type Row = Triage['submissions'][number];

/**
 * The buckets that represent work. `generating` and `awaiting` are not among them — a
 * run in progress and a pull request nobody has run yet are both states to watch rather
 * than act on, and they share the section at the foot of the screen.
 */
type BucketKey = 'draft_ready' | 'needs_manual_review' | 'grading_failed' | 'comment_not_posted';

const BUCKET_META: Record<
  BucketKey,
  {
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: string;
    accent: string;
  }
> = {
  draft_ready: {
    label: 'Drafts ready to review',
    description: 'A report was produced. Read it, edit what you disagree with, then approve.',
    icon: Sparkles,
    tone: 'text-primary',
    accent: 'bg-primary/10',
  },
  needs_manual_review: {
    label: 'Needs manual grading',
    description: 'No confident draft could be produced. These are graded by hand.',
    icon: AlertTriangle,
    tone: 'text-amber-600 dark:text-amber-400',
    accent: 'bg-amber-500/10',
  },
  grading_failed: {
    label: 'Grading failed',
    description: 'The pipeline errored before producing a report. Run it again or grade by hand.',
    icon: XCircle,
    tone: 'text-destructive',
    accent: 'bg-destructive/10',
  },
  comment_not_posted: {
    label: 'Approved, never delivered',
    description:
      'The grade is recorded but the comment never reached the pull request, so the student has not been told. Post it again.',
    icon: MessageSquareOff,
    tone: 'text-amber-600 dark:text-amber-400',
    accent: 'bg-amber-500/10',
  },
};

export function TriageOverview({
  triage,
  instructorName,
  now,
}: {
  triage: Triage;
  instructorName: string | null;
  /**
   * Passed in rather than read here, so every relative time on the screen is measured
   * from one instant and a component cannot disagree with its neighbour.
   */
  now: Date;
}) {
  const buckets = bucketize(triage.submissions);
  const awaiting = triage.submissions.filter(
    (row) => row.bucket === 'awaiting' || row.bucket === 'generating',
  );

  const total =
    buckets.draft_ready.length +
    buckets.needs_manual_review.length +
    buckets.grading_failed.length +
    buckets.comment_not_posted.length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Grading triage"
        description={[
          instructorName,
          `${total} ${total === 1 ? 'item' : 'items'} waiting on you`,
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ready to review" value={buckets.draft_ready.length} icon={Sparkles} tone="text-primary" />
        <StatCard
          label="Manual grading"
          value={buckets.needs_manual_review.length}
          icon={AlertTriangle}
          tone="text-amber-600 dark:text-amber-400"
        />
        <StatCard label="Failed runs" value={buckets.grading_failed.length} icon={XCircle} tone="text-destructive" />
        <StatCard
          label="Approved"
          value={triage.gradedCount}
          icon={CircleCheck}
          tone="text-emerald-600 dark:text-emerald-400"
        />
      </div>

      {total === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing is waiting on you"
          description="Submissions appear here once a report has been generated for them, or once one needs grading by hand."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <TriageBucket bucketKey="draft_ready" rows={buckets.draft_ready} now={now} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TriageBucket bucketKey="needs_manual_review" rows={buckets.needs_manual_review} now={now} />
            <TriageBucket bucketKey="grading_failed" rows={buckets.grading_failed} now={now} />
          </div>
          {/*
            Rendered only when it has something in it. An empty "approved, never
            delivered" card reads as a warning on a screen where every other empty card
            reads as being caught up.
          */}
          {buckets.comment_not_posted.length > 0 && (
            <TriageBucket bucketKey="comment_not_posted" rows={buckets.comment_not_posted} now={now} />
          )}
        </div>
      )}

      <Separator />

      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-medium">Open, no report yet</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {awaiting.length}
          </span>
        </div>
        {awaiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open pull requests are waiting for a report.
          </p>
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-1 py-2">
              {awaiting.map((row) => (
                <TriageRow key={row.id} row={row} now={now} />
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

/**
 * Files rows under the bucket the procedure assigned. The decision is made there, once,
 * so a card's count and the rows inside it cannot come from two different readings.
 */
function bucketize(rows: Row[]): Record<BucketKey, Row[]> {
  const buckets: Record<BucketKey, Row[]> = {
    draft_ready: [],
    needs_manual_review: [],
    grading_failed: [],
    comment_not_posted: [],
  };

  for (const row of rows) {
    if (row.bucket && row.bucket in buckets) buckets[row.bucket as BucketKey].push(row);
  }

  return buckets;
}

function TriageBucket({
  bucketKey,
  rows,
  now,
}: {
  bucketKey: BucketKey;
  rows: Row[];
  now: Date;
}) {
  const meta = BUCKET_META[bucketKey];
  const Icon = meta.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg',
              meta.accent,
            )}
          >
            <Icon className={cn('size-5', meta.tone)} />
          </div>
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {meta.label}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {rows.length}
              </span>
            </CardTitle>
            <CardDescription className="mt-1">{meta.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-6 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
            Nothing here.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <TriageRow key={row.id} row={row} now={now} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TriageRow({ row, now }: { row: Row; now: Date }) {
  const draft = row.activeDraft;

  /*
    Only the flags an instructor has to decide about. The rest — mechanical errors,
    imprecise terminology — say points were lost, which is what grading is for and not a
    reason to look at one submission before another.
  */
  const faults = draft
    ? [...new Set(draft.sections.flatMap((s) => s.flags))].filter((code) => flagMeta(code).fault)
    : [];

  const lowConfidence = draft?.sections.some((s) => s.confidence === 'LOW') ?? false;

  // Two columns compared, no API call: the student has pushed past what was graded.
  const revised =
    row.gradedHeadSha != null && row.headSha != null && row.headSha !== row.gradedHeadSha;

  // Not shown for an out-of-date draft: a number proposed against code the student has
  // replaced is worse than no number, because it reads as this submission's score.
  const suggested =
    draft && !row.draftIsStale
      ? draft.sections.reduce(
          (total, section) => ({
            earned: total.earned + (section.editedScoreEarned ?? section.scoreEarned ?? 0),
            possible: total.possible + (section.scorePossible ?? 0),
          }),
          { earned: 0, possible: 0 },
        )
      : null;

  return (
    <Link
      href={gradingQueueHref(row.assignment.id, row.id)}
      className="flex items-center gap-4 rounded-lg border border-transparent px-3 py-3 transition-colors hover:border-border hover:bg-muted/50"
    >
      <Avatar className="size-9">
        <AvatarFallback className="text-xs">{initialsOf(row.student.displayName)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {row.student.displayName ?? row.student.email ?? 'Unknown student'}
        </p>
        <p className="truncate text-sm text-muted-foreground">{row.assignment.title}</p>

        <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:mt-0">
          {row.bucket === 'generating' && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              <Loader2 className="size-3" />
              Generating
            </span>
          )}

          {faults.slice(0, 3).map((code) => (
            <FlagBadge key={code} code={code} />
          ))}
          {lowConfidence && <FlagBadge code="LOW_CONFIDENCE" />}

          {/*
            Why this row is queued rather than ready: the report describes code the
            student has since replaced, and approving it would be refused.
          */}
          {row.draftIsStale && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              <FileClock className="size-3" />
              Draft is out of date
            </span>
          )}

          {revised && !row.draftIsStale && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              <RotateCcw className="size-3" />
              Revised
            </span>
          )}

          {row.isLate && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              Late
            </span>
          )}
        </div>
      </div>

      {suggested && suggested.possible > 0 && (
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium tabular-nums">
            {scoreLabel(suggested.earned, suggested.possible)}
          </p>
          <p className="text-xs text-muted-foreground">proposed</p>
        </div>
      )}

      <div className="hidden items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground sm:flex">
        <Clock className="size-3.5" />
        {formatRelative(row.lastActivityAt ?? row.submittedAt, now)}
      </div>

      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <Icon className={cn('size-5', tone)} />
        <div>
          <p className="text-2xl leading-none font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function initialsOf(name: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
