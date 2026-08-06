import Link from 'next/link';
import { BarChart3 } from 'lucide-react';

import { EmptyState } from '@/components/list-states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { gradingQueueHref } from '@/lib/links';
import { scoreLabel, scorePercent } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { RouterOutputs } from '@/trpc/types';

/**
 * Every student against every assignment.
 *
 * Each cell links into the grading queue with that submission selected, so reading a
 * number and going to see how it was arrived at is one click. Cells are deliberately
 * sparse: a student who never accepted an assignment gets an em dash, not a zero, and a
 * submission that exists but is not graded gets a dot. Never having started is not the
 * same as having scored nothing, and a gradebook that blurs the two misreports the
 * cohort.
 */

type Gradebook = RouterOutputs['courses']['gradebook'];

export function Gradebook({ data }: { data: Gradebook }) {
  // Only students who are actually in the course. An invitation nobody has redeemed has
  // no work to show and would be a row of em dashes.
  const roster = data.enrollments.flatMap((enrollment) =>
    enrollment.status === 'ACTIVE' && enrollment.student ? [enrollment.student] : [],
  );

  const assignments = [...data.assignments].sort((a, b) => {
    // Course order, which is `module.position` — the sequence an instructor set, not
    // anything alphabetical or parsed out of a name.
    const byModule =
      a.module.position - b.module.position || a.module.name.localeCompare(b.module.name);
    return byModule !== 0 ? byModule : a.title.localeCompare(b.title);
  });

  if (roster.length === 0 || assignments.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Nothing to show yet"
        description="Grades appear here once the course has assignments and students have joined."
      />
    );
  }

  // Keyed lookup rather than a scan per cell: a cohort of twenty against fifty
  // assignments is a thousand cells, and a linear search in each is a million comparisons.
  const cells = new Map(data.cells.map((cell) => [`${cell.assignmentId}:${cell.studentId}`, cell]));

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-card">Student</TableHead>
            {assignments.map((assignment) => (
              <TableHead key={assignment.id} className="text-center">
                {/*
                  `mx-auto` because the truncation needs a block with a max width, and a
                  block without it sits left however the cell is aligned.

                  No point value here: every cell below already reads earned/possible, so
                  a column total would be the same number said twice.
                */}
                <Link
                  href={gradingQueueHref(assignment.id)}
                  className="mx-auto block max-w-28 truncate hover:underline"
                  title={assignment.title}
                >
                  {assignment.title}
                </Link>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {roster.map((student) => (
            <TableRow key={student.id}>
              <TableCell className="sticky left-0 z-10 bg-card font-medium">
                {student.displayName ?? student.email ?? student.githubUsername}
              </TableCell>

              {assignments.map((assignment) => {
                const cell = cells.get(`${assignment.id}:${student.id}`);

                if (!cell) {
                  return (
                    <TableCell key={assignment.id} className="text-center text-muted-foreground">
                      —
                    </TableCell>
                  );
                }

                const graded = cell.finalScore != null;
                const percent = scorePercent(cell.finalScore, cell.finalScorePossible);

                return (
                  <TableCell key={assignment.id} className="p-0 text-center">
                    <Link
                      href={gradingQueueHref(assignment.id, cell.id)}
                      className="flex h-11 items-center justify-center px-3 transition-colors hover:bg-muted/60"
                    >
                      {graded ? (
                        <span
                          className={cn(
                            'text-sm font-medium tabular-nums',
                            cell.isComplete === false
                              ? 'text-destructive'
                              : percent != null && percent >= 0.9
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-foreground',
                          )}
                        >
                          {scoreLabel(cell.finalScore, cell.finalScorePossible)}
                        </span>
                      ) : (
                        // Accepted or submitted but not graded. A dot rather than a
                        // number, because there is no number yet.
                        <span
                          className={cn(
                            'size-2 rounded-full',
                            cell.bucket ? 'bg-amber-500' : 'bg-muted-foreground/40',
                          )}
                          aria-label={cell.bucket ? 'Waiting on you' : cell.status}
                          title={cell.bucket ? 'Waiting on you' : cell.status}
                        />
                      )}
                    </Link>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
