"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatTakenOn, GCF_KIND_META, GCF_KINDS, gcfScoreLabel, sortByTakenOn } from "@/lib/gcf";
import { studentLabel } from "@/lib/gradebook/filters";
import { studentHref } from "@/lib/links";
import { useTRPC } from "@/trpc/client";
import type { GcfKind } from "@/lib/gcf";
import type { RouterOutputs } from "@/trpc/types";

/**
 * One fellow's GCF record: what they have sat, and a way to add or correct an attempt.
 *
 * **The note is the reason editing exists at all.** A flag arrives from CodeSignal with no account
 * of itself, and the fellow sees it on their own page — so an instructor writing what it was about
 * is what turns a mark on somebody's record into something they can ask about rather than
 * something they discover from an employer.
 *
 * Recording by hand is upserted on the same day-and-kind the import writes on, so entering a
 * attempt the export later carries updates that row rather than creating a second record of one
 * morning. That is the property that makes typing one in safe rather than a thing to undo later.
 */

type Gcf = RouterOutputs["gcf"]["forCourse"];
type Student = Gcf["activeStudents"][number];
type Attempt = Gcf["attempts"][number];

/** A mock's default maximum: four tasks at 300. Overridable, because the number of tasks varies. */
const DEFAULT_MOCK_POSSIBLE = 1200;

export function GcfAttemptDialog({
  courseId,
  students,
  student,
  attempts,
  open,
  onOpenChange,
}: {
  courseId: string;
  students: Student[];
  /** The fellow whose record is open, or null when recording from scratch. */
  student: Student | null;
  attempts: Attempt[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [studentId, setStudentId] = React.useState<string>(student?.id ?? "");
  const [kind, setKind] = React.useState<GcfKind>("PROCTORED");
  const [score, setScore] = React.useState("");
  const [takenOn, setTakenOn] = React.useState("");
  const [note, setNote] = React.useState("");

  // Follows the row the dialog was opened from, so reopening on somebody else does not keep the
  // previous fellow selected.
  React.useEffect(() => {
    if (open) setStudentId(student?.id ?? "");
  }, [open, student]);

  const record = useMutation(
    trpc.gcf.record.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Attempt recorded.");
          setScore("");
          setTakenOn("");
          setNote("");
        },
      }),
    ),
  );

  const update = useMutation(
    trpc.gcf.update.mutationOptions(settled({ onSuccess: () => toast.success("Note saved.") })),
  );

  const remove = useMutation(
    trpc.gcf.remove.mutationOptions(
      settled({ onSuccess: () => toast.success("Attempt removed.") }),
    ),
  );

  const busy = record.isPending || update.isPending || remove.isPending;
  const scoreValue = Number(score);
  const canSubmit =
    studentId !== "" && takenOn !== "" && score !== "" && Number.isFinite(scoreValue) && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{student ? studentLabel(student) : "Record a GCF attempt"}</DialogTitle>
          <DialogDescription>
            An attempt is identified by the fellow, the kind, and the day. Recording one that is
            already on file updates it rather than adding a second.
          </DialogDescription>
        </DialogHeader>

        {/*
          Where the other gradebook tabs go when a student's name is clicked.

          The GCF tab's first column opens this dialog instead, which is the one inconsistency in
          the grid — so the destination it displaced is offered here rather than being lost. A
          reader who wanted the record and got the attempts is one click from what they meant.
        */}
        {student && (
          <Link
            href={studentHref(courseId, student.id)}
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Open {studentLabel(student)}&apos;s full record
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        )}

        {student && attempts.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">On file</h3>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {sortByTakenOn(attempts).map((attempt) => (
                <AttemptRow
                  key={attempt.id}
                  attempt={attempt}
                  busy={busy}
                  onNote={(value) => update.mutate({ attemptId: attempt.id, note: value || null })}
                  onRemove={() => remove.mutate({ attemptId: attempt.id })}
                />
              ))}
            </ul>
          </section>
        )}

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;

            record.mutate({
              courseId,
              studentId,
              kind,
              score: Math.round(scoreValue),
              // Only a mock has a maximum; a proctored score sits on the 200–600 band and the
              // export reports none, so sending one would invent a denominator.
              scorePossible: kind === "MOCK" ? DEFAULT_MOCK_POSSIBLE : null,
              takenOn,
              integrityFlagged: false,
              note: note.trim() || null,
            });
          }}
        >
          <h3 className="text-sm font-medium">
            {attempts.length > 0 ? "Add another" : "Record one"}
          </h3>

          {!student && (
            <div className="flex flex-col gap-1.5">
              <Label>Student</Label>
              <Select
                value={studentId}
                onValueChange={(value) => setStudentId(value ?? "")}
                items={Object.fromEntries(students.map((row) => [row.id, studentLabel(row)]))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a student" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {studentLabel(row)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>Which</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind((value ?? "PROCTORED") as GcfKind)}
                items={Object.fromEntries(GCF_KINDS.map((k) => [k, GCF_KIND_META[k].label]))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GCF_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {GCF_KIND_META[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gcf-score">
                Score {kind === "MOCK" ? `out of ${DEFAULT_MOCK_POSSIBLE}` : "(200–600)"}
              </Label>
              <Input
                id="gcf-score"
                inputMode="numeric"
                value={score}
                onChange={(event) => setScore(event.target.value)}
                placeholder={kind === "MOCK" ? "840" : "512"}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gcf-date">Day sat</Label>
              <Input
                id="gcf-date"
                type="date"
                value={takenOn}
                onChange={(event) => setTakenOn(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gcf-note">Note (optional)</Label>
            <Textarea
              id="gcf-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="Anything the fellow should know about this attempt. They can read it."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {record.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
              Record
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AttemptRow({
  attempt,
  busy,
  onNote,
  onRemove,
}: {
  attempt: Attempt;
  busy: boolean;
  onNote: (note: string) => void;
  onRemove: () => void;
}) {
  const [note, setNote] = React.useState(attempt.note ?? "");
  const [editing, setEditing] = React.useState(false);

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium tabular-nums">{gcfScoreLabel(attempt)}</span>
        <Badge variant="secondary">{GCF_KIND_META[attempt.kind].label}</Badge>
        <span className="text-xs text-muted-foreground">{formatTakenOn(attempt.takenOn)}</span>

        {attempt.integrityFlagged && (
          <Badge variant="outline" className="gap-1 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3" />
            Integrity flagged
          </Badge>
        )}

        <span className="flex-1" />

        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
          {attempt.note ? "Edit note" : "Add note"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={busy}
          onClick={onRemove}
          aria-label="Remove this attempt"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {/*
        Shown whenever there is one, not only while editing. The fellow reads this on their own
        page, so an instructor should be able to see what it says without pressing anything.
      */}
      {attempt.note && !editing && <p className="text-xs text-muted-foreground">{attempt.note}</p>}

      {attempt.integrityFlagged && !attempt.note && !editing && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          CodeSignal flagged this and the fellow can see that. Write a note saying what it was about
          — without one they have a mark on their record and nothing to go on.
        </p>
      )}

      {editing && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="What this was about. The fellow can read it."
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                onNote(note);
                setEditing(false);
              }}
            >
              Save note
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setNote(attempt.note ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
