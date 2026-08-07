'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Inbox, Search, UserMinus } from 'lucide-react';

import { GradingReview } from '@/components/instructor/grading-review';
import { SubmissionRow } from '@/components/instructor/submission-row';
import { studentHref } from '@/lib/links';
import { Input } from '@/components/ui/input';
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

  /*
    The selection survives a filter that no longer contains it, so switching tabs does not
    quietly swap the student being read.

    `removedSubmissions` is searched too, and only here. A removed student is never in the list —
    nobody is going to grade work from somebody who has left, which is why they are out of triage
    as well — but the gradebook's Removed table links straight to one of these, and a link into a
    screen that will not show what it points at is worse than no link at all. So the pile is the
    cohort, and asking for one submission by name still answers.
  */
  const selected =
    submissions.find((row) => row.id === selectedId) ??
    data.removedSubmissions.find((row) => row.id === selectedId) ??
    filtered[0] ??
    null;

  /** Whether the open submission belongs to somebody no longer in the cohort. */
  const selectedIsRemoved =
    selected !== null && data.removedSubmissions.some((row) => row.id === selected.id);

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
                  {
                    key: 'needs_review', label: `To do`, count: counts.needs_review
                  },
                  { key: 'graded', label: `Graded`, count: counts.graded },
                  { key: 'all', label: `All`, count: counts.all },
                ] as { key: Filter; label: string; count: number }[]
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
                  {tab.label}<br />({tab.count})
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
                  <SubmissionRow
                    key={row.id}
                    row={row}
                    primary={
                      row.student.displayName ??
                      row.student.githubUsername ??
                      row.student.email ??
                      'Unknown student'
                    }
                    active={selected?.id === row.id}
                    onSelect={() => select(row.id)}
                    now={now}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden bg-muted/20">
          {/*
            Said before the work rather than left to be noticed. This submission is not in the
            list beside it, and an instructor who read a report and approved it without knowing
            the student had left the cohort would be grading somebody who is not there.
          */}
          {selectedIsRemoved && selected && (
            <div className="flex shrink-0 items-start gap-2 border-b border-border bg-muted/60 px-4 py-2.5 text-sm">
              <UserMinus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  {selected.student.displayName ??
                    selected.student.githubUsername ??
                    selected.student.email ??
                    'This student'}
                </span>{' '}
                has been removed from this cohort, so this is not in the queue beside it. Their
                work stays readable here and in the gradebook.
              </p>
            </div>
          )}

          {/*
            `min-h-0 flex-1` because the review pane sizes itself with `h-full` and scrolls
            inside. Without it, the banner above would push the bottom of the pane — the approve
            button among it — off the screen.
          */}
          <div className="min-h-0 flex-1">
            {selected ? (
              // Keyed on the submission so switching students resets the editor rather
              // than carrying one student's unsaved edits onto another's report.
              <GradingReview
                key={selected.id}
                submission={selected}
                assignmentTitle={data.assignment.title}
                // "What else has this person done" is the question a report prompts, and until
                // now there was nowhere in the application to answer it.
                studentHref={studentHref(data.assignment.courseId, selected.student.id)}
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
          </div>
        </section>
      </div>
    </div>
  );
}

