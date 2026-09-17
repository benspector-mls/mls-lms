"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { displayNameOf } from "@/lib/people";
import {
  END_OF_DAY,
  instantAtSchoolClock,
  schoolClockOf,
  schoolDayOf,
  type SchoolClock,
} from "@/lib/school-time";
import { formatDueDate } from "@/lib/status";
import { useTRPC } from "@/trpc/client";

/** The three columns `displayNameOf` falls through. Structural, so any select carrying them fits. */
type Person = { displayName: string | null; email: string | null; githubUsername: string | null };

/**
 * A deadline agreed with one fellow, on one piece of work.
 *
 * **What it does not do is move the assignment's due date.** The class deadline stands, `isLate`
 * goes on recording that it was missed, and this records what was agreed instead — so the record
 * can say both that a fellow missed a deadline and that they renegotiated one and met it. That
 * distinction is the whole reason the feature exists, and it is why the strip below always names
 * the original deadline beside the agreed one.
 *
 * **Reachable whether or not anything has been handed in.** An extension agreed in advance is
 * agreed with somebody who has submitted nothing, and the row holding it is created by the grant —
 * which is also what puts the new date on the fellow's own dashboard and in their calendar, so the
 * days they were given do not read to them as days of being overdue.
 *
 * Refused by the server on team work, where one hand-in carries one verdict for every member. The
 * strip is not drawn there at all, so the refusal is a guard rather than something an instructor
 * meets.
 */
export function ExtensionControl({
  assignmentId,
  studentId,
  studentName,
  /** Whether this work is handed in by teams, which decides who an agreement reaches. */
  isTeamWork,
  /** The team's name, for saying whose deadline is being moved. Null before they are on one. */
  teamName,
  /** The assignment's own deadline. Null means there is nothing to extend, and nothing is drawn. */
  dueAt,
  /** The deadline agreed for this work, or null where none was. */
  extendedDueAt,
  /** Who agreed to it and when, for the line that says so. Null alongside a null extension. */
  grantedBy,
  grantedAt,
}: {
  assignmentId: string;
  studentId: string;
  studentName: string;
  isTeamWork: boolean;
  teamName: string | null;
  dueAt: Date | null;
  extendedDueAt: Date | null;
  grantedBy: Person | null;
  grantedAt: Date | null;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [open, setOpen] = React.useState(false);

  /*
    Who the agreement is with. On team work it is the team, because the work is handed in once and
    the new date reaches every member — an instructor reading one fellow's record is otherwise a
    keystroke away from believing they are moving one fellow's deadline.
  */
  const subject = isTeamWork ? (teamName ? `Team ${teamName}` : "the whole team") : studentName;

  const grant = useMutation(
    trpc.submissions.grantExtension.mutationOptions(
      settled({
        onSuccess: (result) => {
          setOpen(false);
          toast.success(
            result.extendedDueAt
              ? `${subject} now has until ${formatDueDate(result.extendedDueAt)}.`
              : `Extension removed for ${subject}.`,
          );
        },
      }),
    ),
  );

  /*
    Work with no deadline cannot be late, so there is nothing here to agree about — and the server
    refuses the grant for the same reason. Drawing a disabled control would be offering a choice
    that does not arise.
  */
  if (dueAt === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-background px-4 py-2 text-sm">
      <CalendarClock className="size-4 shrink-0 text-muted-foreground" />

      <span className="text-muted-foreground">Due {formatDueDate(dueAt)}</span>

      {extendedDueAt ? (
        <span className="text-sky-700 dark:text-sky-300">
          {/*
            Whose agreement it is, said on the strip and not only in the dialog. An instructor
            arriving at a fellow's record and finding an extension already in place has not seen the
            dialog, and on team work the date they are reading was agreed with the team.
          */}
          Extended to {formatDueDate(extendedDueAt)}
          {isTeamWork ? ` for ${subject}` : ""}
          {grantedBy ? ` by ${displayNameOf(grantedBy, "somebody")}` : ""}
          {grantedAt ? ` on ${formatDueDate(grantedAt)}` : ""}
        </span>
      ) : null}

      <span className="ml-auto flex items-center gap-2">
        {extendedDueAt && (
          /*
            Taking an agreement back rather than editing it to an earlier date, which is what an
            instructor means when the extension turned out not to be needed. It clears all three
            columns together, which is the only other state the table admits.
          */
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={grant.isPending}
            onClick={() => grant.mutate({ assignmentId, studentId, extendedDueAt: null })}
          >
            Remove
          </Button>
        )}

        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          {extendedDueAt ? "Change" : "Grant extension"}
        </Button>
      </span>

      <ExtensionDialog
        open={open}
        onOpenChange={setOpen}
        subject={subject}
        isTeamWork={isTeamWork}
        dueAt={dueAt}
        extendedDueAt={extendedDueAt}
        pending={grant.isPending}
        error={grant.error?.message ?? null}
        onSubmit={(at) => grant.mutate({ assignmentId, studentId, extendedDueAt: at })}
      />
    </div>
  );
}

/**
 * The date and time of the new deadline.
 *
 * The same pair of inputs the assignment form asks a due date with, and the same school-time
 * helpers, so an instructor types a deadline here the way they type one there and both mean New
 * York time. Starting at 11:59pm for a date picked with no time is that form's rule too.
 */
function ExtensionDialog({
  open,
  onOpenChange,
  subject,
  isTeamWork,
  dueAt,
  extendedDueAt,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose deadline is being moved: the fellow, or their team. */
  subject: string;
  isTeamWork: boolean;
  dueAt: Date;
  extendedDueAt: Date | null;
  pending: boolean;
  error: string | null;
  onSubmit: (at: Date) => void;
}) {
  /*
    Seeded from whatever stands, and re-seeded each time the dialog opens rather than held across
    closes — an instructor who opened it, thought better of it, and opened it again on another
    assignment should not find the first one's date waiting for them.
  */
  const [at, setAt] = React.useState<Date | null>(extendedDueAt);
  const lastClock = React.useRef<SchoolClock>(END_OF_DAY);

  React.useEffect(() => {
    if (open) setAt(extendedDueAt);
  }, [open, extendedDueAt]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Extension for {subject}</DialogTitle>
          <DialogDescription>
            {isTeamWork && (
              <>
                This work is handed in once by the team, so the new deadline applies to every member
                of it.{" "}
              </>
            )}
            The assignment stays due {formatDueDate(dueAt)} for everybody else. This work will still
            be recorded as having missed that deadline — handing in by the new one is what reads as
            extended rather than late.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="extension-date">New due date</Label>
            <Input
              id="extension-date"
              type="date"
              value={at ? schoolDayOf(at) : ""}
              onChange={(event) =>
                setAt(
                  event.target.value
                    ? instantAtSchoolClock(
                        event.target.value,
                        at ? schoolClockOf(at) : lastClock.current,
                      )
                    : null,
                )
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="extension-time">New due time</Label>
            <Input
              id="extension-time"
              type="time"
              disabled={at === null}
              value={at ? schoolClockOf(at) : ""}
              onChange={(event) => {
                const clock = event.target.value || END_OF_DAY;
                lastClock.current = clock;
                setAt(at ? instantAtSchoolClock(schoolDayOf(at), clock) : null);
              }}
            />
          </div>
        </div>

        {/*
          The refusal in place rather than in a toast, because every one this mutation gives is
          about what was typed — a date before the assignment's own, or work handed in by a team —
          and a message about what you typed should stay on screen while you fix it.
        */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={at === null || pending}
            onClick={() => at && onSubmit(at)}
          >
            {extendedDueAt ? "Change extension" : "Grant extension"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
