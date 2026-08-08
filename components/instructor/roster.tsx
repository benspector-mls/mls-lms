"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as React from "react";
import { Check, Copy, GitBranch, RotateCcw, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/list-states";
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
import { studentHref } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * The roster: the join link, and who has used it.
 *
 * **Removed students are shown, not filtered out.** This is the instructor's own list and the
 * one screen where a departed student has to be visible — they are who Restore acts on, and a
 * roster that silently omitted them would make removal look like deletion.
 *
 * In their own table below the cohort, though, rather than dimmed among it. One list mixing the
 * two made "who is in this cohort" a question you answered by reading opacity, and put the
 * Restore button in the same column as Remove — two rows apart, opposite in effect.
 */

type Data = RouterOutputs["courses"]["roster"];

export function CourseRoster({ data }: { data: Data }) {
  const trpc = useTRPC();
  const router = useRouter();
  const courseId = data.course.id;

  const settled = {
    onSuccess: () => router.refresh(),
    onError: (error: { message: string }) => toast.error(error.message),
  };

  const remove = useMutation(
    trpc.enrollments.remove.mutationOptions({
      ...settled,
      onSuccess: (result) => {
        toast.success(`Removed ${result.studentName} from the cohort.`);
        router.refresh();
      },
    }),
  );
  const restore = useMutation(
    trpc.enrollments.restore.mutationOptions({
      ...settled,
      onSuccess: (result) => {
        toast.success(`${result.studentName} is back in the cohort.`);
        router.refresh();
      },
    }),
  );
  const regenerate = useMutation(
    trpc.courses.regenerateJoinToken.mutationOptions({
      ...settled,
      onSuccess: () => {
        toast.success("New join link. The old one no longer works.");
        router.refresh();
      },
    }),
  );

  const busy = remove.isPending || restore.isPending || regenerate.isPending;
  // Complements, so every enrollment lands in exactly one table. See the same reasoning in
  // `courses.gradebook`: filters naming both statuses would lose a third one from both lists.
  const active = data.enrollments.filter((enrollment) => enrollment.status === "ACTIVE");
  const removed = data.enrollments.filter((enrollment) => enrollment.status !== "ACTIVE");

  return (
    <div className="flex flex-col gap-4">
      <JoinLinkCard
        joinToken={data.course.joinToken}
        active={active.length}
        busy={busy}
        onRegenerate={() => regenerate.mutate({ courseId })}
      />

      {data.enrollments.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Nobody has joined yet"
          description="Send the link above. Students appear here as they use it."
        />
      ) : (
        <>
          {active.length > 0 && (
            <RosterTable
              courseId={courseId}
              enrollments={active}
              busy={busy}
              onRemove={(enrollmentId) => remove.mutate({ enrollmentId })}
              onRestore={(enrollmentId) => restore.mutate({ enrollmentId })}
            />
          )}

          {/*
            Below the cohort and labelled, not mixed into it. What an instructor needs from this
            list is that these people were here and can be put back — and that they are not part
            of any count on the screen above.
          */}
          {removed.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-medium">Removed students · {removed.length}</h3>
                <p className="text-xs text-muted-foreground">
                  Out of the cohort&apos;s counts, out of grading triage, and out of the grading
                  queue. Everything they submitted stays readable, to them and in the gradebook.
                  Restore puts them back where they were.
                </p>
              </div>
              <RosterTable
                courseId={courseId}
                enrollments={removed}
                busy={busy}
                onRemove={(enrollmentId) => remove.mutate({ enrollmentId })}
                onRestore={(enrollmentId) => restore.mutate({ enrollmentId })}
              />
            </section>
          )}
        </>
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
 */
function JoinLinkCard({
  joinToken,
  active,
  busy,
  onRegenerate,
}: {
  joinToken: string;
  active: number;
  busy: boolean;
  onRegenerate: () => void;
}) {
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
          Send this to your students however you already talk to them. Anyone who opens it and signs
          in with GitHub joins this cohort, so treat it as you would a class password.
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
            {active === 1 ? "student" : "students"} already in the cohort stay enrolled — anyone who
            has not joined yet will need the new link.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                onRegenerate();
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
  courseId,
  enrollments,
  busy,
  onRemove,
  onRestore,
}: {
  courseId: string;
  enrollments: Data["enrollments"];
  busy: boolean;
  onRemove: (enrollmentId: string) => void;
  onRestore: (enrollmentId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead className="hidden sm:table-cell">GitHub</TableHead>
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
                      {/* Into their record for this cohort: every submission, every grade, and
                          the email and GitHub username a repository name is checked against. */}
                      <Link
                        href={studentHref(courseId, enrollment.student.id)}
                        className="truncate font-medium hover:underline"
                      >
                        {name}
                      </Link>
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
                <TableCell>
                  <EnrollmentBadge status={enrollment.status} />
                </TableCell>
                <TableCell className="text-right">
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
    // Grey rather than red. Removing a student is an ordinary administrative act, not a
    // failure, and their work is untouched — a warning colour would say otherwise.
    REMOVED: { label: "Removed", className: "border-border text-muted-foreground" },
  };

  return (
    <Badge variant="outline" className={cn("font-normal", meta[status].className)}>
      {meta[status].label}
    </Badge>
  );
}

function initials(name: string | null): string {
  return (name ?? "?")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
