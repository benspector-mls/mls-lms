'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { ArrowLeft, GitBranch, Inbox, Mail, UserMinus } from 'lucide-react';

import { GradingReview } from '@/components/instructor/grading-review';
import { SubmissionRow, initials } from '@/components/instructor/submission-row';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { courseHref, studentHref } from '@/lib/links';
import { cn } from '@/lib/utils';
import type { RouterOutputs } from '@/trpc/types';

/**
 * One student's whole record in one cohort, with the selected submission open beside it.
 *
 * **The grading queue's other axis, and deliberately the same screen.** The queue is one assignment
 * across many students; this is one student across many assignments. The row component and the
 * review surface are shared rather than reimplemented, so reading a student's work looks and
 * behaves exactly like grading it — because it is the same act, approached from the other side.
 *
 * What differs is small and each difference has a reason. There is no search box: filtering one
 * student by name is nothing. Every assignment gets a row, including ones they never started,
 * because "has not begun this" is a fact about a student that a list of only their submissions
 * cannot state. And the row's second line is the module rather than a relative time, since forty
 * rows all reading "3 days ago" order nothing.
 */

type Data = RouterOutputs['submissions']['listForStudent'];
type Row = Data['rows'][number];

type Filter = 'all' | 'needs_review' | 'graded' | 'not_started';

export function StudentOverview({ data, now }: { data: Data; now: Date }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('submission');

  const [filter, setFilter] = React.useState<Filter>('all');

  const started = data.rows.filter((row) => row.submission !== null);

  const needsReview = (row: Row) =>
    row.submission != null &&
    row.submission.bucket !== null &&
    row.submission.bucket !== 'generating';

  const counts = {
    all: data.rows.length,
    needs_review: data.rows.filter(needsReview).length,
    graded: started.filter((row) => row.submission!.status === 'GRADED').length,
    not_started: data.rows.filter((row) => row.submission === null).length,
  };

  const filtered = data.rows.filter((row) => {
    if (filter === 'needs_review') return needsReview(row);
    if (filter === 'graded') return row.submission?.status === 'GRADED';
    if (filter === 'not_started') return row.submission === null;
    return true;
  });

  /*
    The selection survives a filter that no longer contains it, and falls back to the first row that
    *has* a submission rather than the first row — opening this screen on an assignment nobody has
    started would show an empty review pane and read as the page being broken.
  */
  const selected =
    started.find((row) => row.submission!.id === selectedId) ??
    filtered.find((row) => row.submission !== null) ??
    started[0] ??
    null;

  function select(submissionId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('submission', submissionId);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  const name =
    data.student.displayName ??
    data.student.githubUsername ??
    data.student.email ??
    'Unknown student';

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col">
      <StudentHeader data={data} name={name} />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_1fr]">
        <aside className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
          <div className="border-b border-border p-3">
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              {(
                [
                  { key: 'all', label: `All (${counts.all})` },
                  { key: 'needs_review', label: `To do (${counts.needs_review})` },
                  { key: 'graded', label: `Graded (${counts.graded})` },
                  { key: 'not_started', label: `Not started (${counts.not_started})` },
                ] as { key: Filter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilter(tab.key)}
                  className={cn(
                    'flex-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors',
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
                  {counts.all === 0
                    ? 'This cohort has no assignments yet.'
                    : 'No assignments match.'}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {filtered.map((row) =>
                  row.submission ? (
                    <SubmissionRow
                      key={row.assignment.id}
                      row={row.submission}
                      primary={row.assignment.title}
                      secondary={row.assignment.module.name}
                      active={selected?.assignment.id === row.assignment.id}
                      onSelect={() => select(row.submission!.id)}
                      now={now}
                    />
                  ) : (
                    <NotStartedRow key={row.assignment.id} row={row} />
                  ),
                )}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden bg-muted/20">
          {/*
            `min-h-0 flex-1` because the review pane sizes itself with `h-full` and scrolls inside.
            Without it the header above would push the approve button off the screen.
          */}
          <div className="min-h-0 flex-1">
            {selected?.submission ? (
              // Keyed on the submission so moving between assignments resets the editor rather
              // than carrying unsaved edits from one report onto another.
              <GradingReview
                key={selected.submission.id}
                submission={selected.submission}
                assignmentTitle={selected.assignment.title}
                assignmentKind={selected.assignment.kind}
                // Per row here, where the queue reads it once for the page: every row on this
                // screen is a different assignment, and the threshold is what decides whether a
                // score passes.
                completionThreshold={selected.assignment.completionThreshold}
                now={now}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <Inbox className="size-10 text-muted-foreground" />
                <p className="text-base font-medium">Nothing handed in yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {name} has not started any of this cohort&apos;s assignments. Their work opens
                  here once there is some.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Who this is, and which cohort you are reading them in.
 *
 * The email and GitHub username are the point of the header rather than decoration: they are what
 * an instructor needs when a repository name does not match the person they expected, and there
 * was previously nowhere in the application to look them up.
 */
function StudentHeader({ data, name }: { data: Data; name: string }) {
  const router = useRouter();
  const removed = data.enrollmentStatus !== 'ACTIVE';

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-border bg-card px-4 py-3 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
          {initials(name)}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-base font-semibold">{name}</h1>
            {removed && (
              <Badge variant="outline" className="gap-1 font-normal">
                <UserMinus className="size-3" />
                Removed from this cohort
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {data.student.email && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Mail className="size-3 shrink-0" />
                <span className="truncate">{data.student.email}</span>
              </span>
            )}
            {data.student.githubUsername ? (
              <a
                href={`https://github.com/${data.student.githubUsername}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                <GitBranch className="size-3 shrink-0" />@{data.student.githubUsername}
              </a>
            ) : (
              // Worth saying rather than leaving blank: without a linked GitHub account this
              // student cannot accept a repository assignment at all, which is the explanation
              // for a row of "not started" that would otherwise look like avoidance.
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <GitBranch className="size-3 shrink-0" />
                No GitHub account linked
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/*
          The cohort being read, switchable to another this student is in. Separate from the
          sidebar's course switcher, which knows nothing about this student and would offer cohorts
          they are not in — a student repeating a module has two records, and this is how you get
          from one to the other.
        */}
        {data.courses.length > 1 ? (
          <Select
            value={data.course.id}
            onValueChange={(id) => {
              if (id) router.push(studentHref(id, data.student.id));
            }}
            items={Object.fromEntries(
              data.courses.map((course) => [course.id, `${course.name} · ${course.cohortTerm}`]),
            )}
          >
            <SelectTrigger size="sm" aria-label="Which cohort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {data.courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{course.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {course.cohortTerm}
                        {course.enrolledAs !== 'ACTIVE' && ' · removed'}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">
            {data.course.name} · {data.course.cohortTerm}
          </span>
        )}

        <Link
          href={courseHref(data.course.id)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Course
        </Link>
      </div>
    </header>
  );
}

/**
 * An assignment this student has no submission for.
 *
 * Not selectable, because there is nothing to open. Present because its absence would be
 * indistinguishable from the assignment not existing — the count above says how many, and this is
 * which ones.
 */
function NotStartedRow({ row }: { row: Row }) {
  return (
    <li>
      <div className="flex items-center gap-2.5 rounded-md border border-transparent px-3 py-2.5 opacity-60">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-xs text-muted-foreground">
          —
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{row.assignment.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {row.assignment.module.name}
          </span>
        </div>
        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {row.assignment.distributedAt === null ? 'Not published' : 'Not started'}
        </span>
      </div>
    </li>
  );
}
