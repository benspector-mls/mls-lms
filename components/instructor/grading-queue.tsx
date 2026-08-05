'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Inbox, Search } from 'lucide-react';

import { GradingReview } from '@/components/instructor/grading-review';
import { DraftStatusBadge, SubmissionStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { formatRelative, shortSha } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { RouterOutputs } from '@/trpc/types';

/**
 * Every submission for one assignment, with the selected one open beside the list.
 *
 * Two panes rather than a list that navigates: grading is done in a sitting, one student
 * after another, and losing the queue on every selection would make that a chore.
 * Selection lives in the query string so a particular review can be linked to — which is
 * how the triage screen sends you here.
 */

type Data = RouterOutputs['submissions']['listForAssignment'];
type Row = Data['submissions'][number];

type Filter = 'needs_review' | 'graded' | 'all';

export function GradingQueue({
  data,
  completionThreshold,
  now,
}: {
  data: Data;
  completionThreshold: number;
  now: Date;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('submission');

  const [filter, setFilter] = React.useState<Filter>('needs_review');
  const [query, setQuery] = React.useState('');

  /*
    A student who has not opened a pull request is not in the queue. They have not done
    anything wrong and there is nothing to grade — the assignment's own page is where an
    instructor goes to see who has not started.
  */
  const submissions = data.submissions.filter(
    (row) => row.status !== 'NOT_STARTED' && row.status !== 'ACCEPTED',
  );

  /*
    "Needs review" is the same question the triage screen asks, answered by the same
    field. A submission cannot be outstanding work on one screen and finished on the
    other.
  */
  const needsReview = (row: Row) => row.bucket !== null && row.bucket !== 'generating';

  const counts = {
    needs_review: submissions.filter(needsReview).length,
    graded: submissions.filter((row) => row.status === 'GRADED').length,
    all: submissions.length,
  };

  // Filtering a cohort's worth of rows is not work worth memoizing, and `submissions` is
  // a fresh array on every render anyway, so a memo here would recompute regardless.
  const term = query.trim().toLowerCase();
  const filtered = submissions
    .filter((row) => {
      if (filter === 'needs_review') return needsReview(row);
      if (filter === 'graded') return row.status === 'GRADED';
      return true;
    })
    .filter(
      (row) =>
        !term ||
        (row.student.displayName ?? '').toLowerCase().includes(term) ||
        (row.student.githubUsername ?? '').toLowerCase().includes(term) ||
        (row.student.email ?? '').toLowerCase().includes(term),
    );

  // The selection survives a filter that no longer contains it, so switching tabs does
  // not quietly swap the student being read.
  const selected =
    submissions.find((row) => row.id === selectedId) ?? filtered[0] ?? null;

  function select(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('submission', id);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  /*
    No page heading. The shell's breadcrumb already reads "Triage · Grading · {title}"
    with Triage linked, so a heading here would repeat the assignment name and spend a
    fifth of the viewport doing it. This screen is worked down, not read — the list and
    the submission get the whole height.
  */
  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_1fr]">
        <aside className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
          <div className="flex flex-col gap-3 border-b border-border p-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search students…"
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              {(
                [
                  { key: 'needs_review', label: `To do (${counts.needs_review})` },
                  { key: 'graded', label: `Graded (${counts.graded})` },
                  { key: 'all', label: `All (${counts.all})` },
                ] as { key: Filter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilter(tab.key)}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                    filter === tab.key
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <Inbox className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">Nothing here</p>
                <p className="text-xs text-muted-foreground">
                  {filter === 'needs_review'
                    ? 'Every submission for this assignment has been dealt with.'
                    : 'No submissions match.'}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {filtered.map((row) => (
                  <QueueRow
                    key={row.id}
                    row={row}
                    active={selected?.id === row.id}
                    onSelect={() => select(row.id)}
                    now={now}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-hidden bg-muted/20">
          {selected ? (
            // Keyed on the submission so switching students resets the editor rather
            // than carrying one student's unsaved edits onto another's report.
            <GradingReview
              key={selected.id}
              submission={selected}
              assignmentTitle={data.assignment.title}
              // Read here rather than by the review pane, which would have to wait on its
              // own request to find out whether this assignment can have tests at all.
              assignmentKind={data.assignment.kind}
              completionThreshold={completionThreshold}
              now={now}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <Inbox className="size-10 text-muted-foreground" />
              <p className="text-base font-medium">Pick a student</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Their report, test results, and repository open here.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function QueueRow({
  row,
  active,
  onSelect,
  now,
}: {
  row: Row;
  active: boolean;
  onSelect: () => void;
  now: Date;
}) {
  const draft = row.activeDraft;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full flex-col gap-2 rounded-md border px-3 py-2.5 text-left transition-colors',
          active
            ? 'border-primary/40 bg-primary/5'
            : 'border-transparent hover:border-border hover:bg-muted/50',
        )}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
            {initials(row.student.displayName ?? row.student.email)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">
              {row.student.displayName ?? row.student.githubUsername ?? row.student.email ?? 'Unknown student'}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {shortSha(row.headSha)} · {formatRelative(row.lastActivityAt ?? row.submittedAt, now)}
            </span>
          </div>
          {/*
            The released grade, right-aligned so the column of scores can be read straight
            down the list without opening each submission. Only a grade that has actually
            gone out is shown here — a superseded score belongs to a report nobody reads
            anymore.
          */}
          {row.status === 'GRADED' && row.finalScore != null && (
            <span
              className={cn(
                'shrink-0 text-sm font-semibold tabular-nums',
                row.isComplete
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-destructive',
              )}
            >
              {row.finalScore}
              <span className="font-normal text-muted-foreground">/{row.finalScorePossible}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <SubmissionStatusBadge status={row.status} />
          {/*
            The draft's own state, which is not the submission's — generating a report
            does not move the submission, only approving does. Approved and superseded
            drafts are left off: the submission badge already says GRADED, and a
            superseded draft is history rather than a state to act on.
          */}
          {draft && draft.status !== 'APPROVED' && draft.status !== 'SUPERSEDED' && (
            <DraftStatusBadge status={draft.status} />
          )}
          {row.draftIsStale && (
            <Badge
              variant="outline"
              className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
            >
              Report out of date
            </Badge>
          )}
          {row.bucket === 'comment_not_posted' && (
            <Badge
              variant="outline"
              className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
            >
              Not delivered
            </Badge>
          )}
        </div>
      </button>
    </li>
  );
}

function initials(name: string | null): string {
  return (name ?? '?')
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
