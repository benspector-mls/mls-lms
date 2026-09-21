"use client";

import { useMutation } from "@tanstack/react-query";
import { Eye, Paperclip, Pencil, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UploadedFileRow } from "@/components/uploaded-file";
import { shownInPlace, useServerMutation } from "@/hooks/use-server-mutation";
import { formatDateTime } from "@/lib/status";
import {
  MAX_SUBMISSION_ARTIFACTS,
  MAX_UPLOAD_BYTES,
  UPLOAD_FILE_TYPE_KEYS,
  acceptAttributeFor,
  checkUpload,
  describeAcceptedTypes,
  formatBytes,
} from "@/lib/uploads/file-types";
import { sendFile } from "@/lib/uploads/send-file";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Goal = RouterOutputs["coaching"]["myGoals"]["goals"][number];
type Update = Goal["updates"][number];

/**
 * The updates under one goal: how it is going, in the fellow's words, with files as evidence.
 *
 * **The fellow's to write and nobody else's.** `editable` is true on their own goals page and
 * false on the two instructor screens, and that one flag is the whole difference: the same rows,
 * the same files, the same order, with the controls present or absent. An instructor who wants
 * to respond to an update says so in the coaching session.
 *
 * **Links are markdown.** A fellow pastes `[what it is](https://…)` into the text and the
 * renderer makes it a link, so there is no second kind of attachment to store, list, or remove.
 * Files are the evidence a link cannot carry — a screenshot, a document — and travel the same
 * path a submission's file does: a signed address, the browser's own PUT, then a row.
 *
 * Read-only readers reach the bytes through `coaching.updateAttachmentUrl`, which is the same
 * `UploadedFileRow` the review screen uses with a different id on it.
 */
export function GoalUpdates({
  goal,
  programId,
  editable,
}: {
  goal: Goal;
  programId: string;
  editable: boolean;
}) {
  const [adding, setAdding] = React.useState(false);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Updates · {goal.updates.length}
        </span>
        {editable && !adding && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setAdding(true)}
            data-icon="inline-start"
          >
            <Plus aria-hidden />
            Add an update
          </Button>
        )}
      </div>

      {adding && (
        <UpdateEditor
          programId={programId}
          goalId={goal.id}
          update={null}
          onDone={() => setAdding(false)}
        />
      )}

      {goal.updates.length === 0 ? (
        !adding && (
          <p className="text-sm text-muted-foreground">
            {editable
              ? "Nothing written under this goal yet. An update is how it is going — a few lines, a screenshot, a link to something you made."
              : "They have not written anything under this goal yet."}
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {goal.updates.map((update) => (
            <UpdateItem
              key={update.id}
              update={update}
              programId={programId}
              goalId={goal.id}
              editable={editable}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One update as it reads: the date, the words, the files. */
function UpdateItem({
  update,
  programId,
  goalId,
  editable,
}: {
  update: Update;
  programId: string;
  goalId: string;
  editable: boolean;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [editing, setEditing] = React.useState(false);

  const remove = useMutation(
    trpc.coaching.deleteUpdate.mutationOptions(
      settled({ onSuccess: () => toast.success("Update removed.") }),
    ),
  );

  if (editing) {
    return (
      <li>
        <UpdateEditor
          programId={programId}
          goalId={goalId}
          update={update}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{formatDateTime(update.createdAt)}</span>
        {editable && (
          <span className="ml-auto flex items-center gap-1">
            <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ programId, updateId: update.id })}
              className="text-destructive hover:text-destructive"
            >
              Delete
            </Button>
          </span>
        )}
      </div>

      {update.body !== "" && <Markdown content={update.body} />}

      {update.attachments.map((attachment) => (
        <UploadedFileRow
          key={attachment.id}
          attachmentId={attachment.id}
          programId={programId}
          filename={attachment.uploadFilename}
          sizeBytes={attachment.uploadSizeBytes}
          label="Attached"
          addedAt={attachment.createdAt}
        />
      ))}
    </li>
  );
}

/**
 * Writing an update, or changing one.
 *
 * **The words save first, then the files, one at a time** — the shape of the assignment panel's
 * upload form, for its reasons: the bytes never come through this application, so each file is
 * a signed address, the browser's own PUT with a progress bar, and a row. A file that fails is
 * reported in place with its name, and everything before it stands: the words are saved, the
 * files that went through are attached, and pressing Save again sends only what is left.
 *
 * That is why a new update becomes an edit the moment its words are saved (`savedId`): a retry
 * after a failed file must not create the update a second time.
 */
function UpdateEditor({
  programId,
  goalId,
  update,
  onDone,
}: {
  programId: string;
  goalId: string;
  /** The update being changed, or null to write a new one. */
  update: Update | null;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [body, setBody] = React.useState(update?.body ?? "");
  const [previewing, setPreviewing] = React.useState(false);
  const [files, setFiles] = React.useState<File[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  /** How much of the file in flight has been sent, or null when nothing is. */
  const [percent, setPercent] = React.useState<number | null>(null);
  /** Which of the chosen files is in flight, one-based, for the label beside the bar. */
  const [sending, setSending] = React.useState(0);
  /** The update's id once its words exist, so a retry edits rather than adds. */
  const [savedId, setSavedId] = React.useState<string | null>(update?.id ?? null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const inputId = `update-files-${update?.id ?? goalId}`;

  const attached = update?.attachments.length ?? 0;
  const remaining = MAX_SUBMISSION_ARTIFACTS - attached;

  /*
    Only the mutations that change what is on screen refresh it. `beginUpdateUpload` hands back
    an address and records nothing a fellow can see; refreshing on it would re-render the page
    in the middle of an upload, for no change.
  */
  const add = useMutation(
    trpc.coaching.addUpdate.mutationOptions(settled({ onError: shownInPlace })),
  );
  const edit = useMutation(
    trpc.coaching.editUpdate.mutationOptions(settled({ onError: shownInPlace })),
  );
  const begin = useMutation(trpc.coaching.beginUpdateUpload.mutationOptions());
  const record = useMutation(
    trpc.coaching.recordUpdateUpload.mutationOptions(settled({ onError: shownInPlace })),
  );
  const removeFile = useMutation(trpc.coaching.deleteUpdateAttachment.mutationOptions(settled()));

  const choose = (chosen: File[]) => {
    setFiles(chosen);
    if (chosen.length === 0) return setError(null);

    if (chosen.length > remaining) {
      return setError(
        remaining <= 0
          ? `This update already holds ${MAX_SUBMISSION_ARTIFACTS} files, which is the most it can.`
          : `This update has room for ${remaining} more ${remaining === 1 ? "file" : "files"}, and you chose ${chosen.length}.`,
      );
    }

    for (const file of chosen) {
      const check = checkUpload({
        filename: file.name,
        sizeBytes: file.size,
        acceptedTypes: UPLOAD_FILE_TYPE_KEYS,
      });
      if (!check.ok) {
        return setError(chosen.length === 1 ? check.reason : `${file.name}: ${check.reason}`);
      }
    }

    setError(null);
  };

  const hasSomething = body.trim() !== "" || files.length > 0 || attached > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!hasSomething || busy || error) return;

    setBusy(true);
    setError(null);

    try {
      const saved =
        savedId === null
          ? await add.mutateAsync({ programId, goalId, body })
          : await edit.mutateAsync({ programId, updateId: savedId, body });
      setSavedId(saved.id);

      for (const [index, file] of files.entries()) {
        setSending(index + 1);
        setPercent(0);

        const destination = await begin.mutateAsync({
          programId,
          updateId: saved.id,
          filename: file.name,
          sizeBytes: file.size,
        });

        await sendFile({
          url: destination.uploadUrl,
          contentType: destination.contentType,
          file,
          onProgress: setPercent,
        });

        await record.mutateAsync({
          programId,
          updateId: saved.id,
          path: destination.path,
          filename: file.name,
        });

        // Attached, so a retry after a later failure does not send this one again.
        setFiles((current) => current.filter((held) => held !== file));
      }

      toast.success(update === null ? "Update added." : "Update saved.");
      onDone();
    } catch (err) {
      /*
        Every refusal on this path is written for a fellow — by the procedures, by the bucket
        through `sendFile`, or by `checkUpload` before any of them — so the message is shown
        rather than replaced. The filename is added where several were chosen, because otherwise
        the sentence does not say which one stopped.
      */
      const said = err instanceof Error ? err.message : "That did not go through. Try again.";
      const failing = files[sending - 1];
      setError(failing && files.length > 1 ? `${failing.name}: ${said}` : said);
    } finally {
      setBusy(false);
      setPercent(null);
      setSending(0);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {update === null ? "New update" : "Edit update"}
        </span>
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
        <div className="min-h-24 rounded-md border border-border bg-muted/20 p-3">
          <Markdown content={body} />
        </div>
      ) : (
        <Textarea
          autoFocus
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          maxLength={20_000}
          placeholder="How is it going? What did you try, and what happened?"
        />
      )}
      <p className="text-xs text-muted-foreground">
        Markdown. To include a link, write it as <code>[what it is](https://…)</code>.
      </p>

      {/* Files already attached, each with its own remove — the words above are saved separately. */}
      {update !== null && update.attachments.length > 0 && (
        <ul className="flex flex-col gap-1">
          {update.attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-2 text-sm">
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {attachment.uploadFilename}
                <span className="text-muted-foreground">
                  {" "}
                  — {formatBytes(attachment.uploadSizeBytes)}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={removeFile.isPending || busy}
                onClick={() => removeFile.mutate({ programId, attachmentId: attachment.id })}
                className="text-destructive hover:text-destructive"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50"
        >
          <Paperclip className="size-3.5" aria-hidden />
          {files.length === 0
            ? "Attach files"
            : files.length === 1
              ? `${files[0]!.name} — ${formatBytes(files[0]!.size)}`
              : `${files.length} files chosen`}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={acceptAttributeFor(UPLOAD_FILE_TYPE_KEYS)}
          disabled={busy || remaining <= 0}
          onChange={(event) => choose([...(event.target.files ?? [])])}
          className="sr-only"
        />
        <p className="text-xs text-muted-foreground">
          {describeAcceptedTypes(UPLOAD_FILE_TYPE_KEYS)}, up to {formatBytes(MAX_UPLOAD_BYTES)} each
          and {MAX_SUBMISSION_ARTIFACTS} per update. Your instructors can open them; nobody else
          can.
        </p>
      </div>

      {percent !== null && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            Sending {sending} of {files.length} — {percent}%
          </span>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!hasSomething || busy || error !== null}>
          {busy ? "Saving…" : update === null && savedId === null ? "Add update" : "Save"}
        </Button>
      </div>
    </form>
  );
}
