"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Send, X } from "lucide-react";
import * as React from "react";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { shownInPlace } from "@/hooks/use-server-mutation";
import { MAX_COMMENT_LENGTH } from "@/lib/submissions/comments";
import { useTRPC } from "@/trpc/client";

/** The round a draft is answering, when it was begun from under one. */
export type ComposerAnchor = { id: string; number: number };

/**
 * Writing one message, in a textarea with an Edit and Preview toggle — the pattern
 * `section-editor.tsx` established for the other place markdown is written here.
 *
 * **The draft is held by the caller**: the fellow's Comments tab is unmounted while another tab
 * shows, so a half-typed question kept in here would be lost by clicking Feedback and back. There
 * is one composer per screen, so that is one string and needs no context.
 *
 * **The anchor is fixed by where the writing began, never picked from a menu.** Started under a
 * round it answers that round; started in the thread it answers none. Clearing the chip is the
 * only control.
 */
export function CommentComposer({
  assignmentId,
  studentId,
  value,
  onValueChange,
  anchor = null,
  onClearAnchor,
  onPosted,
  label = "Add a comment",
  placeholder = "Ask your instructor anything about this assignment…",
  submitLabel = "Post",
  autoFocus = false,
}: {
  assignmentId: string;
  /** Whose work. Omitted for the caller's own, which is what a fellow sends. */
  studentId?: string;
  value: string;
  onValueChange: (next: string) => void;
  anchor?: ComposerAnchor | null;
  onClearAnchor?: () => void;
  onPosted?: () => void;
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(true);
  const fieldRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fieldId = React.useId();

  const post = useMutation(
    trpc.submissionComments.post.mutationOptions({
      // Beside the field, not in a toast: it is about what you typed, so it stays while you fix it.
      onError: shownInPlace,
      onSuccess: () => {
        onValueChange("");
        onClearAnchor?.();
        setEditing(true);
        onPosted?.();
        // Only this thread: `useServerMutation` would re-render the course page behind the sheet.
        void queryClient.invalidateQueries({
          queryKey: trpc.submissionComments.thread.queryKey({ assignmentId, studentId }),
        });
        fieldRef.current?.focus();
      },
    }),
  );

  const body = value.trim();
  const remaining = MAX_COMMENT_LENGTH - value.length;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (body === "" || post.isPending) return;
    post.mutate({ assignmentId, studentId, body, gradingDraftId: anchor?.id ?? null });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={fieldId} className="text-sm font-medium">
          {label}
        </label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditing(!editing)}
          disabled={body === ""}
        >
          <Pencil data-icon="inline-start" />
          {editing ? "Preview" : "Edit"}
        </Button>
      </div>

      {anchor && (
        <div className="flex items-center gap-1.5 self-start rounded-full border border-border bg-muted/40 py-1 pr-1 pl-2.5 text-xs">
          <span className="text-muted-foreground">Responding to Review {anchor.number}</span>
          {onClearAnchor && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Stop responding to Review ${anchor.number}`}
              className="size-4 rounded-full text-muted-foreground"
              onClick={onClearAnchor}
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      )}

      {editing ? (
        <Textarea
          id={fieldId}
          ref={fieldRef}
          rows={4}
          autoFocus={autoFocus}
          value={value}
          maxLength={MAX_COMMENT_LENGTH}
          placeholder={placeholder}
          className="font-mono text-xs"
          onChange={(event) => onValueChange(event.target.value)}
          /*
            Cmd or Ctrl and Enter, never Enter alone: the body is markdown. `requestSubmit` uses the
            same handler as the button, so this cannot drift into a second submit path.
          */
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      ) : (
        <div className="rounded-md border border-border bg-muted/20 p-4">
          <Markdown content={value} />
        </div>
      )}

      {post.error && (
        <p role="alert" className="text-sm text-destructive">
          {post.error.message}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {/* Only near the ceiling: a counter always on says the limit is worth thinking about. */}
        <span className="text-xs text-muted-foreground tabular-nums">
          {remaining <= MAX_COMMENT_LENGTH * 0.1 ? `${remaining} characters left` : ""}
        </span>
        <Button type="submit" size="sm" disabled={body === "" || post.isPending}>
          {post.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Send data-icon="inline-start" />
          )}
          {post.isPending ? "Posting…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
