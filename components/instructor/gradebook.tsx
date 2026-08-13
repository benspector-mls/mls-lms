import Link from "next/link";
import { BarChart3 } from "lucide-react";

import { EmptyState } from "@/components/list-states";
import { TestStudentBadge } from "@/components/test-student-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { gradebookIsEmpty, sortGradebookAssignments } from "@/lib/gradebook/csv";
import {
  awaitingByStudent,
  completionByAssignment,
  completionByStudent,
  completionLabel,
} from "@/lib/gradebook/summary";
import { gradingQueueHref, studentHref } from "@/lib/links";
import { scoreLabel, scorePercent, SUBMISSION_STATUS_META } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Every student against every assignment.
 *
 * Each cell links into the grading queue with that submission selected, so reading a
 * number and going to see how it was arrived at is one click. Cells are deliberately
 * sparse: a student who never accepted an assignment gets an empty ring, not a zero, and
 * a submission that exists but is not graded gets a filled dot. Never having started is
 * not the same as having scored nothing, and a gradebook that blurs the two misreports
 * the cohort. `CellMark` draws all three and the legend above the grid names them.
 *
 * **Two tables, because removing a student does not delete their work.** The cohort's figures are
 * the students in it; a departed student's record is kept and read separately. One table holding
 * both would make every count above it wrong, and dropping them altogether would take back the
 * thing removal is supposed to preserve.
 */

type Gradebook = RouterOutputs["courses"]["gradebook"];
type Assignment = Gradebook["assignments"][number];
type Cell = Gradebook["cells"][number];
// From the active list rather than a whole-roster one, which this payload no longer carries.
// Either complement has the same shape, so which it is read off is a question of what exists.
type Student = Gradebook["activeEnrollments"][number]["student"];

export function Gradebook({ data }: { data: Gradebook }) {
  const active = data.activeEnrollments.map((enrollment) => enrollment.student);
  const removed = data.removedEnrollments.map((enrollment) => enrollment.student);

  /*
    Course order, which is `module.position` — the sequence an instructor set, not anything
    alphabetical or parsed out of a name. Shared with the CSV export rather than sorted here, so the
    columns of the downloaded file are these columns in this order.
  */
  const assignments = sortGradebookAssignments(data.assignments);

  if (gradebookIsEmpty(data)) {
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
      <CellLegend />

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
 * The three marks a cell carries when it has no score, drawn from one definition.
 *
 * **One shape at three fills, rather than three unrelated symbols.** They were a dot, a dot, and an
 * em dash, and the dash was the odd one — a typographic mark for "no value" standing in a row with
 * two pieces of interface, which read as a different kind of thing rather than as the first step of
 * the same scale. A ring, a grey dot, and an amber dot are one scale, in the order work actually
 * moves: nothing taken up, taken up, handed in.
 *
 * The same distinction is drawn the same way on the student's progress bar, where "not accepted" is
 * outlined and "accepted" is filled. Two screens describing one fact should not need two visual
 * languages to do it.
 *
 * **Fill against outline rather than two colours**, which is what keeps the pair legible to a
 * reader who cannot tell the hues apart — and every mark carries its label as text besides.
 */
const CELL_MARK = {
  notStarted: "border border-muted-foreground/50",
  accepted: "bg-muted-foreground/40",
  waiting: "bg-amber-500",
} as const;

function CellMark({ kind, label }: { kind: keyof typeof CELL_MARK; label?: string }) {
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", CELL_MARK[kind])}
      aria-label={label}
      title={label}
      // Decoration wherever the label is already beside it in text, which is the legend.
      aria-hidden={label === undefined ? true : undefined}
    />
  );
}

/**
 * What a cell that is not a score means.
 *
 * **Three marks that are not self-explanatory, and the grid is where they appear.** A number is
 * read without help, where a mark is a convention — and the one the grid most needs to keep apart
 * is the empty ring against the grey dot, since never having started is not the same as having
 * scored nothing.
 *
 * **The labels come from `SUBMISSION_STATUS_META` rather than being written here.** That map is the
 * instructor's vocabulary, read by the triage list, the queue, and every badge in the application,
 * so a legend naming these states itself would be a second set of words for them, free to drift
 * from the badges a reader sees the moment they follow a cell.
 *
 * **The sentences beside them are written here, and deliberately not taken from the same map.**
 * Those descriptions are about repositories — "No repository created yet", "Repository created; no
 * pull request opened yet" — which is true of a `REPO` assignment and false of the other three
 * kinds. A gradebook mixes kinds freely, so a legend explaining every em dash in a column of Google
 * Docs as a missing repository would be confidently wrong. These say the same thing without naming
 * a mechanism.
 *
 * `NOT_STARTED` is the em dash and `ACCEPTED` the grey dot, which is what those cells mean in
 * practice: the row exists only once a student has taken the work up, so its absence is a student
 * who has not. The amber dot is the one entry with no status behind it, because it is not a status
 * — `bucket` is a triage question, and "Waiting on you" is the phrase the cell itself already uses.
 */
function CellLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      <LegendItem
        mark={<CellMark kind="notStarted" />}
        label={SUBMISSION_STATUS_META.NOT_STARTED.label}
        description="never accepted, and nothing handed in"
      />
      <LegendItem
        mark={<CellMark kind="accepted" />}
        label={SUBMISSION_STATUS_META.ACCEPTED.label}
        description="taken up, with nothing handed in yet"
      />
      <LegendItem
        mark={<CellMark kind="waiting" />}
        label="Waiting on you"
        description="handed in and not yet graded"
      />
    </ul>
  );
}

function LegendItem({
  mark,
  label,
  description,
}: {
  mark: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <li className="flex items-center gap-1.5">
      {/* A fixed width so the three marks line up, since an em dash and a dot are different sizes. */}
      <span className="flex w-3 shrink-0 items-center justify-center">{mark}</span>
      <span className="font-medium text-foreground">{label}</span>
      {/*
        The description beside the label rather than in a tooltip. There are three of them, they
        are one clause each, and a legend that has to be hovered to be read is a legend nobody
        reads — which is the whole failure it exists to prevent.
      */}
      <span>— {description}</span>
    </li>
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
  pending: "waiting" | "not-graded";
}) {
  // Keyed lookup rather than a scan per cell: a cohort of twenty against fifty
  // assignments is a thousand cells, and a linear search in each is a million comparisons.
  const byKey = new Map(cells.map((cell) => [`${cell.assignmentId}:${cell.studentId}`, cell]));

  /*
    The same cells counted along both axes, from the payload the grid is already drawn from rather
    than a read of its own — which is what stops a total describing a different cohort than the
    rows beneath it. Each table counts only itself: the removed students' table summarises removed
    students, which is the reading that keeps it from contributing to the cohort's figures.
  */
  const downColumn = completionByAssignment(cells, students.length);
  const acrossRow = completionByStudent(cells, assignments.length);

  /*
    Only where a pending submission is work outstanding. In the removed students' table it is not:
    that work is out of triage and out of the queue, so nobody is going to grade it — the same
    reason the amber dot is suppressed there. A count of it would claim a task that does not exist
    and cannot be cleared.
  */
  const awaiting = pending === "waiting" ? awaitingByStudent(cells) : null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-card">Student</TableHead>
            {/*
              Before the assignments rather than after them, so it is beside the name it describes
              rather than at the end of a row fifty columns long.

              Deliberately not a second frozen column. Only one thing can be pinned to `left-0`,
              and pinning a second means hand-computing its offset from the first column's width —
              which the table does not fix, so a long name would push the two apart and leave a
              gap that scrolls. The name is what has to stay visible while reading across; this
              scrolls with the work it counts.
            */}
            <TableHead className="text-center">
              <span className="mx-auto block max-w-28 text-xs leading-tight">
                Completed
                <br />
                assignments
              </span>
            </TableHead>

            {/*
              Beside the completed count rather than anywhere else, because the two are read
              together: how far along this student is, and how much of that is sitting with me.
            */}
            <TableHead className="text-center">
              <span className="mx-auto block max-w-28 text-xs leading-tight">
                Assignments
                <br />
                to be graded
              </span>
            </TableHead>
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

          {/*
            How many finished each assignment, directly under its name and above the students.

            A second header row rather than the first row of the body, because it describes the
            columns rather than belonging to anybody — a summary sitting among the students reads
            as a student, and on a cohort of five that matters.
          */}
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-10 bg-card text-xs font-normal text-muted-foreground">
              Completed
            </TableHead>
            <TableHead />
            <TableHead />
            {assignments.map((assignment) => (
              <TableHead
                key={assignment.id}
                className="text-center text-xs font-medium tabular-nums text-muted-foreground"
              >
                {completionLabel(downColumn.get(assignment.id), students.length)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((student) => (
            <TableRow key={student.id}>
              <TableCell className="sticky left-0 z-10 bg-card font-medium">
                {/* Into their record for this cohort. A row of scores prompts "what happened
                    with this person", and the name is where a reader already points. */}
                <div className="flex items-center gap-2">
                  <Link href={studentHref(courseId, student.id)} className="hover:underline">
                    {student.displayName ?? student.email ?? student.githubUsername}
                  </Link>
                  {student.testStudentNumber !== null && <TestStudentBadge />}
                </div>
              </TableCell>

              {/*
                Against every assignment in the course, including any not yet handed out, so this
                figure does not move when an instructor publishes something nobody has seen.
              */}
              <TableCell className="text-center text-sm font-medium tabular-nums text-muted-foreground">
                {completionLabel(acrossRow.get(student.id), assignments.length)}
              </TableCell>

              {/*
                Amber when there is anything, and the same amber as the dots it counts, so a reader
                scanning this column for the students who need attention is looking for the colour
                the cells beside it already use. Zero is muted rather than hidden: "nothing waiting"
                is worth reading, and a blank cell says only that something failed to render.
              */}
              <TableCell
                className={cn(
                  "text-center text-sm tabular-nums",
                  awaiting?.get(student.id)
                    ? "font-medium text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground",
                )}
              >
                {awaiting === null ? "—" : (awaiting.get(student.id) ?? 0)}
              </TableCell>

              {assignments.map((assignment) => {
                const cell = byKey.get(`${assignment.id}:${student.id}`);

                if (!cell) {
                  /*
                    No submission row at all, which is the same fact as `NOT_STARTED` and drawn the
                    same way. An empty ring rather than an em dash: the dash was a typographic mark
                    for "no value" sitting among two interface dots, and it read as a different kind
                    of thing rather than as the first step of the same scale.
                  */
                  return (
                    <TableCell key={assignment.id} className="text-center">
                      <span className="flex items-center justify-center">
                        <CellMark
                          kind="notStarted"
                          label={SUBMISSION_STATUS_META.NOT_STARTED.label}
                        />
                      </span>
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
                            "text-sm font-medium tabular-nums",
                            cell.isComplete === false
                              ? "text-destructive"
                              : percent != null && percent >= 0.9
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-foreground",
                          )}
                        >
                          {scoreLabel(cell.finalScore, cell.finalScorePossible)}
                        </span>
                      ) : pending === "not-graded" ? (
                        // In words rather than as a dot. A dot needs a legend, and the one
                        // thing worth knowing about a removed student's ungraded work is
                        // exactly that: it was never graded.
                        <span className="text-xs text-muted-foreground">Not graded</span>
                      ) : (
                        /*
                          Accepted or submitted but not graded. A mark rather than a number,
                          because there is no number yet — and the same mark the legend draws,
                          from `CELL_MARK`, so the two cannot come to disagree.

                          The label goes through `SUBMISSION_STATUS_META` rather than the raw
                          column, which put `NOT_STARTED` in a tooltip. The legend names these
                          states in the instructor's vocabulary, and a cell answering in database
                          values would not match the words a reader had just been given.
                        */
                        <CellMark
                          kind={cell.bucket ? "waiting" : "accepted"}
                          label={
                            cell.bucket
                              ? "Waiting on you"
                              : SUBMISSION_STATUS_META[cell.status].label
                          }
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
