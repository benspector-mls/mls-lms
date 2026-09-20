"use client";

import { useMutation } from "@tanstack/react-query";
import { Eye, Pencil, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { displayNameOf } from "@/lib/people";
import { formatDate } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Note = RouterOutputs["coaching"]["forStudent"]["notes"][number];

/**
 * Staff observations about one fellow: the list, and the one dialog that writes it.
 *
 * **Never shown to fellows, and the section says so** — the caption is the strongest control this
 * feature has over what gets written, because a writer who believes a field is private writes
 * sentences they would not say. The words here are still disclosable: a fellow may ask to read
 * their record, so the caption states the fact rather than promising secrecy.
 *
 * One dialog for adding and editing, keyed on which note it was opened with — the resource-dialog
 * shape, markdown `Textarea` and Eye/Pencil preview toggle included. Deleting lives inside the
 * edit dialog rather than on the row: reaching it means having deliberately opened the note.
 */
export function InstructorNotes({
  programId,
  studentId,
  notes,
}: {
  programId: string;
  studentId: string;
  notes: Note[];
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Note | null>(null);
  const [body, setBody] = React.useState("");
  const [previewing, setPreviewing] = React.useState(false);

  const openFor = (note: Note | null) => {
    setEditing(note);
    setBody(note?.body ?? "");
    setPreviewing(false);
    setOpen(true);
  };

  const add = useMutation(
    trpc.coaching.addNote.mutationOptions(settled({ onSuccess: () => setOpen(false) })),
  );
  const update = useMutation(
    trpc.coaching.updateNote.mutationOptions(settled({ onSuccess: () => setOpen(false) })),
  );
  const remove = useMutation(
    trpc.coaching.deleteNote.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Note deleted.");
          setOpen(false);
        },
      }),
    ),
  );

  const busy = add.isPending || update.isPending || remove.isPending;
  const complete = body.trim().length > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!complete || busy) return;
    if (editing === null) {
      add.mutate({ programId, studentId, body });
    } else {
      update.mutate({ programId, noteId: editing.id, body });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {notes.length === 0 ? (
        <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
          No notes on this fellow.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {notes.map((note) => (
            <li key={note.id} className="flex flex-col gap-1.5 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-muted-foreground">
                  {note.author ? displayNameOf(note.author, "somebody") : "A former instructor"} ·{" "}
                  {formatDate(note.createdAt)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="ml-auto"
                  onClick={() => openFor(note)}
                >
                  Edit
                </Button>
              </div>
              <Markdown content={note.body} />
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => openFor(null)}
        data-icon="inline-start"
      >
        <Plus aria-hidden />
        Add a note
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit note" : "Add a note"}</DialogTitle>
              <DialogDescription>
                Staff only — never shown to fellows. A fellow may still ask to read their record, so
                write what happened and what was decided, as you would say it to them.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">The note</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={body.trim() === ""}
                  onClick={() => setPreviewing((current) => !current)}
                  data-icon="inline-start"
                >
                  {previewing ? <Pencil aria-hidden /> : <Eye aria-hidden />}
                  {previewing ? "Edit" : "Preview"}
                </Button>
              </div>

              {previewing ? (
                <div className="max-h-[35vh] min-h-52 overflow-y-auto rounded-md border border-border bg-muted/20 p-4">
                  <Markdown content={body} />
                </div>
              ) : (
                <Textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={10}
                  maxLength={50_000}
                  className="max-h-[35vh] font-mono text-sm"
                  placeholder="Markdown, rendered the way feedback is."
                />
              )}
            </div>

            <DialogFooter className="gap-2">
              {editing !== null && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => remove.mutate({ programId, noteId: editing.id })}
                  className="mr-auto text-destructive hover:text-destructive"
                >
                  Delete note
                </Button>
              )}
              <Button type="submit" disabled={!complete || busy}>
                {editing ? "Save note" : "Add note"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
