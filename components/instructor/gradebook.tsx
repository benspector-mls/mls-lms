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
 *
 * **Two tables, because removing a student does not delete their work.** The cohort's figures are
 * the students in it; a departed student's record is kept and read separately. One table holding
 * both would make every count above it wrong, and dropping them altogether would take back the
 * thing removal is supposed to preserve.
 */

type Gradebook = RouterOutputs['courses']['gradebook'];
type Assignment = Gradebook['assignments'][number];
type Cell = Gradebook['cells'][number];
type Student = Gradebook['enrollments'][number]['student'];

export function Gradebook({ data }: { data: Gradebook }) {
  const active = data.activeEnrollments.map((enrollment) => enrollment.student);
  const removed = data.removedEnrollments.map((enrollment) => enrollment.student);

  const assignments = [...data.assignments].sort((a, b) => {
    // Course order, which is `module.position` — the sequence an instructor set, not
    // anything alphabetical or parsed out of a name.
    const byModule =
      a.module.position - b.module.position || a.module.name.localeCompare(b.module.name);
    return byModule !== 0 ? byModule : a.title.localeCompare(b.title);
  });

  if ((active.length === 0 && removed.length === 0) || assignments.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 />}
        title="Nothing to show yet"
        description="Grades appear here once the course has assignments and students have joined."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {active.length > 0 && (
        <Grid
          courseId={data.course.id}
          assignments={assignments}
          students={active}
          cells={data.cells}
          pending="waiting"
        />
      )}

      {removed.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-medium">Removed students</h3>
            <p className="text-xs text-muted-foreground">
              No longer in the cohort, and not counted in any figure above. Their work and the
              feedback they were given stay readable — to them, and here.
            </p>
          </div>
          <Grid
            courseId={data.course.id}
            assignments={assignments}
            students={removed}
            cells={data.removedCells}
            /*
              The one thing the two tables differ by. An ungraded submission from a student who
              has left is not waiting on anybody: it is out of triage and out of the queue, so
              nobody is going to grade it. The amber "waiting on you" dot here would claim an
              outstanding task that does not exist and cannot be cleared.
            */
            pending="not-graded"
          />
        </section>
      )}
    </div>
  );
}

/**
 * One table of students against assignments.
 *
 * `pending` is the whole of what the two callers differ by: whether a submission with no score
 * yet is work outstanding or simply something that never got graded. Everything else is
 * identical, which is why this is one component and not two.
 */
function Grid({
  courseId,
  assignments,
  students,
  cells,
  pending,
}: {
  courseId: string;
  assignments: Assignment[];
  students: Student[];
  cells: Cell[];
  pending: 'waiting' | 'not-graded';
}) {
  // Keyed lookup rather than a scan per cell: a cohort of twenty against fifty
  // assignments is a thousand cells, and a linear search in each is a million comparisons.
  const byKey = new Map(cells.map((cell) => [`${cell.assignmentId}:${cell.studentId}`, cell]));

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
                  href={gradingQueueHref(courseId, assignment.id)}
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
          {students.map((student) => (
            <TableRow key={student.id}>
              <TableCell className="sticky left-0 z-10 bg-card font-medium">
                {student.displayName ?? student.email ?? student.githubUsername}
              </TableCell>

              {assignments.map((assignment) => {
                const cell = byKey.get(`${assignment.id}:${student.id}`);

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
                      href={gradingQueueHref(courseId, assignment.id, cell.id)}
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
                      ) : pending === 'not-graded' ? (
                        // In words rather than as a dot. A dot needs a legend, and the one
                        // thing worth knowing about a removed student's ungraded work is
                        // exactly that: it was never graded.
                        <span className="text-xs text-muted-foreground">Not graded</span>
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
