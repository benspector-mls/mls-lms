"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import {
  Check,
  Copy,
  Eye,
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
 */

type Data = RouterOutputs["programs"]["roster"];

export function ProgramRoster({
  data,
  cohorts,
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
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const programId = data.program.id;

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
  // Complements, so every enrollment lands in exactly one table. See the same reasoning in
  // `courses.gradebook`: filters naming both statuses would lose a third one from both lists.
  const active = data.enrollments.filter((enrollment) => enrollment.status === "ACTIVE");
  const removed = data.enrollments.filter((enrollment) => enrollment.status !== "ACTIVE");

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

      {data.enrollments.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Nobody has joined yet"
          description="Send the join link from Enroll new students. Fellows appear here as they use it."
        />
      ) : (
        <>
          {active.length > 0 && (
            <RosterTable
              programId={programId}
              cohortName={cohortName}
              enrollments={active}
              busy={busy}
              isAdmin={isAdmin}
              onRemove={(enrollmentId) => remove.mutate({ enrollmentId })}
              onRestore={(enrollmentId) => restore.mutate({ enrollmentId })}
              onDelete={setDeleting}
            />
          )}

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
                  Out of the roster&apos;s counts, out of grading triage in every course, and out of
                  the grading queue. Everything they submitted stays readable, to them and in the
                  gradebook. Restore puts them back where they were.
                </p>
              </div>
              <RosterTable
                programId={programId}
                cohortName={cohortName}
                enrollments={removed}
                busy={busy}
                isAdmin={isAdmin}
                onRemove={(enrollmentId) => remove.mutate({ enrollmentId })}
                onRestore={(enrollmentId) => restore.mutate({ enrollmentId })}
                onDelete={setDeleting}
              />
            </section>
          )}
        </>
      )}

      {/*
        Below the roster rather than above it. The tables are what this tab is for; this is a tool
        for checking the courses, and a card at the top would be the first thing an instructor read
        on a screen they opened to look at their fellows.
      */}
      {isAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">View this program as a test student</span>
            <span className="text-xs text-muted-foreground">
              As a test student you can accept work, push to the repository, and submit assignments
              in any course of this program. Then, you can grade them here. Test student data is
              left out of the roster&apos;s count.
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <FlaskConical data-icon="inline-start" />
            Add test student
          </Button>
        </div>
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
          Send this to your fellows however you already talk to them. Anyone who opens it and signs
          in with GitHub joins this program — and every course in it — so treat it as you would a
          class password.
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
            The current link stops working immediately. The {active}{" "}
            {active === 1 ? "fellow" : "fellows"} already on the roster stay enrolled — anyone who
            has not joined yet will need the new link.
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
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fellow</TableHead>
            <TableHead className="hidden sm:table-cell">GitHub</TableHead>
            {/*
              Read-only here, and named rather than counted. The Cohorts tab is where a fellow is
              placed; this column is so that reading the roster shows who is in none, which is who
              an instructor comes looking for when somebody joins by the link mid-term.
            */}
            <TableHead className="hidden md:table-cell">Cohort</TableHead>
            <TableHead>Enrollment</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {enrollments.map((enrollment) => {
            // An enrollment always has a student now, because the row is created by somebody
            // joining. The fallbacks are for a profile that has signed in with GitHub and
            // never set a display name.
            const name =
              enrollment.student.displayName ??
              enrollment.student.githubUsername ??
              enrollment.student.email ??
              "Unnamed";
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
                      <div className="flex min-w-0 items-center gap-2">
                        <Link
                          href={programStudentHref(programId, enrollment.student.id)}
                          className="truncate font-medium hover:underline"
                        >
                          {name}
                        </Link>
                        {/* Beside the name rather than in the Enrollment column, which answers a
                            different question — a test student can also be removed, and both
                            facts have to be readable at once. */}
                        {isTestStudent && <TestStudentBadge />}
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
                    {/*
                      A form rather than a button with an onClick, because entering the view is a
                      cookie and a full navigation — see `app/api/view-as/route.ts`. Only for an
                      active enrollment: looking through a test student that has been removed from
                      this program would show courses it cannot accept anything in.
                    */}
                    {isAdmin && isTestStudent && !removed && (
                      <form method="post" action="/api/view-as">
                        <input type="hidden" name="testStudentId" value={enrollment.student.id} />
                        {/* Where to come back to. A test student can be on several rosters, so
                            leaving cannot work this out later — this is the one moment that knows
                            which one is being checked. */}
                        <input type="hidden" name="programId" value={programId} />
                        <Button size="sm" variant="ghost" type="submit" disabled={busy}>
                          <Eye data-icon="inline-start" />
                          View as
                        </Button>
                      </form>
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
