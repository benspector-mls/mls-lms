"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Copy,
  FlaskConical,
  GitBranch,
  RotateCcw,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { EmptyState } from "@/components/list-states";
import { RemoveTestStudentDialog } from "@/components/instructor/remove-test-student-dialog";
import { TestStudentDialog } from "@/components/instructor/test-student-dialog";
import { ViewAsButton } from "@/components/instructor/view-as-button";
import { TestStudentBadge } from "@/components/test-student-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EnrollmentStatus } from "@/lib/generated/prisma/enums";
import { programStudentHref } from "@/lib/links";
import { initials } from "@/lib/people";
import {
  cohortSelectionLabel,
  inCohortSelection,
  parseCohortSelection,
} from "@/lib/programs/cohorts";
import {
  DEFAULT_ROSTER_SORT,
  sortRoster,
  toggleRosterSort,
  type RosterSort,
  type RosterSortColumn,
} from "@/lib/roster";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Who is in this program: the Active roster tab.
 *
 * **One roster where there used to be one per course**, which is the duplication the program above
 * the course removed. A fellow joins a program once and is a student of every course in it, so
 * this list is entered once rather than once per course of a term.
 *
 * **Removed fellows are shown, not filtered out.** This is the instructor's own list and the one
 * screen where a departed fellow has to be visible — they are who Restore acts on, and a roster
 * that silently omitted them would make removal look like deletion.
 *
 * In their own table below the roster, though, rather than dimmed among it. One list mixing the two
 * made "who is on this roster" a question you answered by reading opacity, and put the Restore
 * button in the same column as Remove — two rows apart, opposite in effect.
 *
 * **Fellow, GitHub and Cohort sort; Enrollment does not.** The two tables are split on exactly that
 * status, so within either one the column holds a single value and a header that sorted it would
 * be a control that visibly does nothing. Each table keeps its own order, because they are two
 * lists answering two questions rather than one list with a divider.
 *
 * **Test students are in neither table.** They have a third, inside the card that makes them, and
 * only an admin sees it. A test student is nobody's fellow, so listing one among the fellows made
 * every reader of the roster check a badge before trusting a row; in their own table they are
 * where the one person who uses them goes looking.
 *
 * **The cohort picker narrows the two fellow tables** and not the test students', which belong to
 * no cohort anybody grades. The narrowing is done here rather than by `programs.roster`, because the
 * same payload feeds the test-student table and has to stay whole for it.
 */

type Data = RouterOutputs["programs"]["roster"];

export function ProgramRoster({
  data,
  cohorts,
  cohort,
}: {
  data: Data;
  /**
   * The program's cohorts, for the column that names each fellow's.
   *
   * Passed in rather than fetched, and read-only here. Placing fellows is the Cohorts tab's whole
   * job; this column exists so that reading the roster answers "who is in nothing" without leaving
   * it, which is the question an instructor asks when somebody joins by the link mid-term.
   */
  cohorts: { id: string; name: string }[];
  /** The cohort picker's selection, as it travels in the query string. */
  cohort: string;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const programId = data.program.id;
  const selection = parseCohortSelection(cohort);

  // Named once rather than searched per row, because a roster of twenty-five would otherwise walk
  // the cohort list twenty-five times to print five names.
  const cohortName = new Map(cohorts.map((cohort) => [cohort.id, cohort.name]));

  const remove = useMutation(
    trpc.enrollments.remove.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(`Removed ${result.studentName} from the program.`);
        },
      }),
    ),
  );
  const restore = useMutation(
    trpc.enrollments.restore.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(`${result.studentName} is back on the roster.`);
        },
      }),
    ),
  );

  /*
    Whether to offer the test student controls at all. Admins only, matching the procedures — an
    instructor pressing a button that always refuses is a worse interface than no button.

    `useQuery` rather than `useSuspenseQuery`: the shell has already fetched this, so it is served
    from the cache, and a boundary here would make the roster wait on a question it only needs in
    order to draw one extra button.
  */
  const { data: profile } = useQuery(trpc.me.queryOptions());
  const isAdmin = profile?.role === "ADMIN";

  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);

  const busy = remove.isPending || restore.isPending;
  /*
    Complements, so every enrollment lands in exactly one table. See the same reasoning in
    `courses.gradebook`: filters naming both statuses would lose a third one from both lists. Test
    students are taken out first, and only the fellows that remain are narrowed to the cohort.
  */
  const testStudents = data.enrollments.filter(
    (enrollment) => enrollment.student.testStudentNumber !== null,
  );
  const fellows = data.enrollments.filter(
    (enrollment) => enrollment.student.testStudentNumber === null,
  );
  const shown = fellows.filter((enrollment) => inCohortSelection(selection, enrollment.cohortId));
  const active = shown.filter((enrollment) => enrollment.status === "ACTIVE");
  const removed = shown.filter((enrollment) => enrollment.status !== "ACTIVE");

  const tableProps = {
    programId,
    cohortName,
    busy,
    isAdmin,
    onRemove: (enrollmentId: string) => remove.mutate({ enrollmentId }),
    onRestore: (enrollmentId: string) => restore.mutate({ enrollmentId }),
    onDelete: setDeleting,
  };

  return (
    <div className="flex flex-col gap-4">
      <TestStudentDialog programId={programId} open={adding} onOpenChange={setAdding} />
      {deleting && (
        <RemoveTestStudentDialog
          profileId={deleting}
          open
          onOpenChange={(next) => {
            if (!next) setDeleting(null);
          }}
        />
      )}

      {fellows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Nobody has joined yet"
          description="Send the join link from Enroll new students. Fellows appear here as they use it."
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={`Nobody in ${cohortSelectionLabel(selection, cohorts)}`}
          description="Choose All fellows above to see the whole roster."
        />
      ) : (
        <>
          {active.length > 0 && <RosterTable {...tableProps} enrollments={active} />}

          {/*
            Below the roster and labelled, not mixed into it. What an instructor needs from this
            list is that these people were here and can be put back — and that they are not part
            of any count on the screen above.
          */}
          {removed.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-medium">Removed fellows · {removed.length}</h3>
                <p className="text-xs text-muted-foreground">
                  Not counted on this roster, in triage, or in the grading queue. Their work stays
                  readable. Restore puts them back.
                </p>
              </div>
              <RosterTable {...tableProps} enrollments={removed} />
            </section>
          )}
        </>
      )}

      {/*
        Below the roster rather than above it. The tables are what this tab is for; this is a tool
        for checking the courses, and a card at the top would be the first thing an instructor read
        on a screen they opened to look at their fellows.

        The test students themselves are listed inside it, in a table of their own, so they are
        never read as fellows. The Enrollment column still says which are removed from this program,
        so one table holds both.
      */}
      {isAdmin && (
        <section className="flex flex-col gap-3 rounded-lg border border-dashed border-border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">View this program as a test student</span>
              <span className="text-xs text-muted-foreground">
                A test student can accept, push, and submit in any course, and you can grade it
                here. Left out of the roster count and Performance.
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <FlaskConical data-icon="inline-start" />
              Add test student
            </Button>
          </div>
          {testStudents.length > 0 && <RosterTable {...tableProps} enrollments={testStudents} />}
        </section>
      )}
    </div>
  );
}

/**
 * The one link that enrolls a student, and the only control over it.
 *
 * The link is shown rather than hidden behind a reveal: it is not a password, it is something
 * an instructor has to copy and send at the start of every term, and putting it behind a click
 * would make the common action slower to protect against a screenshot.
 *
 * **Regenerating says what it costs before it happens.** Anyone who has not joined yet is
 * holding a link that is about to stop working, so the confirmation names that rather than
 * asking "are you sure".
 *
 * On the Enroll new students tab, under the expected list, because those are the two halves of
 * one act: the list says who may join and the link is what they join with. The count of fellows
 * already on the roster is passed in rather than fetched, since the tab beside this one has it.
 */
export function JoinLinkCard({
  programId,
  joinToken,
  active,
}: {
  programId: string;
  joinToken: string;
  /** How many fellows are already enrolled, which the confirmation names. */
  active: number;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const regenerate = useMutation(
    trpc.programs.regenerateJoinToken.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("New join link. The old one no longer works.");
        },
      }),
    ),
  );

  const [copied, setCopied] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  // Built in the browser, because the server rendering this has no reliable idea what host the
  // instructor is looking at — a preview deployment and production share the same code.
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  const link = origin ? `${origin}/join/${joinToken}` : `/join/${joinToken}`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Join link</span>
        <span className="text-xs text-muted-foreground">
          Anyone who opens this link and signs in with GitHub joins this program and every course
          in it. Treat it like a class password.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-xs">
          {link}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 p-3">
          <span className="text-xs text-amber-700 dark:text-amber-300">
            The current link stops working. The {active} {active === 1 ? "fellow" : "fellows"}{" "}
            already on the roster stay enrolled. Anyone who has not joined yet needs the new link.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={regenerate.isPending}
              onClick={() => {
                regenerate.mutate({ programId });
                setConfirming(false);
              }}
            >
              Replace the link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setConfirming(true)}
        >
          Replace this link
        </button>
      )}
    </div>
  );
}

function RosterTable({
  programId,
  cohortName,
  enrollments,
  busy,
  isAdmin,
  onRemove,
  onRestore,
  onDelete,
}: {
  programId: string;
  /** Cohort id to name, so a row prints a name rather than searching the list for one. */
  cohortName: Map<string, string>;
  enrollments: Data["enrollments"];
  busy: boolean;
  /** Whether to draw the test student controls. They refuse anybody else. */
  isAdmin: boolean;
  onRemove: (enrollmentId: string) => void;
  onRestore: (enrollmentId: string) => void;
  onDelete: (profileId: string) => void;
}) {
  const [sort, setSort] = React.useState<RosterSort>(DEFAULT_ROSTER_SORT);

  /*
    What each row reads as in each column, which is also what each cell prints — one rule, so the
    order on screen is the order of the words on screen. The cohort is looked up here rather than
    compared by id, because ids sort into an order nobody can see.
  */
  const ordered = sortRoster(enrollments, sort, (enrollment, by) => {
    if (by === "name") return rosterName(enrollment);
    if (by === "github") return enrollment.student.githubUsername;
    return enrollment.cohortId === null ? null : (cohortName.get(enrollment.cohortId) ?? null);
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="Fellow" by="name" sort={sort} onSort={setSort} />
            <SortableHead
              label="GitHub"
              by="github"
              sort={sort}
              onSort={setSort}
              className="hidden sm:table-cell"
            />
            {/*
              Read-only here, and named rather than counted. The Cohorts tab is where a fellow is
              placed; this column is so that reading the roster shows who is in none, which is who
              an instructor comes looking for when somebody joins by the link mid-term.
            */}
            <SortableHead
              label="Cohort"
              by="cohort"
              sort={sort}
              onSort={setSort}
              className="hidden md:table-cell"
            />
            {/*
              Not sortable, and the docblock says why: this table is already the fellows of one
              status, so every row in it reads the same here.
            */}
            <TableHead>Enrollment</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((enrollment) => {
            const name = rosterName(enrollment);
            const removed = enrollment.status !== "ACTIVE";
            const isTestStudent = enrollment.student.testStudentNumber !== null;

            // No dimming any more. It was how one mixed list said "this person has left", and
            // the two tables say it in words now — dimming on top of a heading that already
            // says so only makes the names harder to read.
            return (
              <TableRow key={enrollment.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                        {initials(enrollment.student.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      {/* Into their record for this program: their attendance and arrival
                          times, their cohort, their GCF history, and a row per course into what
                          they did in it. The work itself is per course and lives a click further
                          in — this page is about the person. */}
                      {/* Before the name rather than after it, as every other screen that draws
                          this badge now does: it is the fact that decides whether to read the row
                          at all, so it should not be something found at the end of a name that
                          may have been truncated before reaching it.

                          Beside the name rather than in the Enrollment column, which answers a
                          different question — a test student can also be removed, and both facts
                          have to be readable at once. */}
                      <div className="flex min-w-0 items-center gap-2">
                        {isTestStudent && <TestStudentBadge />}
                        <Link
                          href={programStudentHref(programId, enrollment.student.id)}
                          className="truncate font-medium hover:underline"
                        >
                          {name}
                        </Link>
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {enrollment.student.email ?? "—"}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {enrollment.student.githubUsername ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <GitBranch className="size-3.5" />
                      {enrollment.student.githubUsername}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {enrollment.cohortId === null ? (
                    // Said in words rather than left blank. An empty cell reads as missing data,
                    // and this is a fact: nobody has placed them yet.
                    <span className="text-sm text-muted-foreground">No cohort</span>
                  ) : (
                    <span className="text-sm">
                      {cohortName.get(enrollment.cohortId) ?? "Unknown cohort"}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <EnrollmentBadge status={enrollment.status} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {!removed && (
                      <ViewAsButton
                        studentId={enrollment.student.id}
                        programId={programId}
                        disabled={busy}
                      />
                    )}

                    {removed ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => onRestore(enrollment.id)}
                      >
                        <RotateCcw data-icon="inline-start" />
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => onRemove(enrollment.id)}
                      >
                        <UserMinus data-icon="inline-start" />
                        Remove
                      </Button>
                    )}

                    {/*
                      Deleting the identity, which is wider than Remove and reaches every roster it
                      is on. Offered beside Remove rather than instead of it, because taking a test
                      student off one roster is a real thing to want.
                    */}
                    {isAdmin && isTestStudent && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => onDelete(enrollment.student.id)}
                      >
                        <Trash2 data-icon="inline-start" />
                        Delete
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * What a fellow is called on this screen.
 *
 * An enrollment always has a student, because the row is created by somebody joining. The
 * fallbacks are for a profile that has signed in with GitHub and never set a display name — and
 * the sort uses this same function, so a fellow shown by their username is ordered by it too.
 */
function rosterName(enrollment: Data["enrollments"][number]): string {
  return (
    enrollment.student.displayName ??
    enrollment.student.githubUsername ??
    enrollment.student.email ??
    "Unnamed"
  );
}

/** A header that sorts the table, with the arrow showing which way when it is the active one. */
function SortableHead({
  label,
  by,
  sort,
  onSort,
  className,
}: {
  label: string;
  by: RosterSortColumn;
  sort: RosterSort;
  onSort: (sort: RosterSort) => void;
  className?: string;
}) {
  const active = sort.by === by;

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(toggleRosterSort(sort, by))}
        aria-label={`Sort by ${label.toLowerCase()}`}
        className={cn(
          "flex items-center gap-1 rounded-sm transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {!active ? (
          <ChevronsUpDown className="size-3 shrink-0" aria-hidden />
        ) : sort.direction === "asc" ? (
          <ArrowUp className="size-3 shrink-0" aria-hidden />
        ) : (
          <ArrowDown className="size-3 shrink-0" aria-hidden />
        )}
      </button>
    </TableHead>
  );
}

function EnrollmentBadge({ status }: { status: EnrollmentStatus }) {
  const meta: Record<EnrollmentStatus, { label: string; className: string }> = {
    ACTIVE: {
      label: "Active",
      className: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
    },
    // Grey rather than red. Removing a fellow is an ordinary administrative act, not a
    // failure, and their work is untouched — a warning colour would say otherwise.
    REMOVED: { label: "Removed", className: "border-border text-muted-foreground" },
  };

  return (
    <Badge variant="outline" className={cn("font-normal", meta[status].className)}>
      {meta[status].label}
    </Badge>
  );
}
