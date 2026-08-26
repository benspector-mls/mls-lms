"use client";

import { Trash2 } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/markdown";
import { initials } from "@/lib/people";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

import type { Comment } from "./types";

/**
 * One message. The only thing that draws a comment, so the thread and the card under a round of
 * feedback cannot disagree about what one looks like.
 *
 * `now` is a prop, as on every screen here: a component reading its own clock renders a different
 * string on the server than in the browser.
 */
export function CommentItem({
  comment,
  now,
  onDelete,
  deleting = false,
  /** Whether to say which round this is about. False inside that round's own card. */
  showRound = true,
}: {
  comment: Comment;
  now: Date;
  onDelete?: (commentId: string) => void;
  deleting?: boolean;
  showRound?: boolean;
}) {
  const withdrawn = comment.body === null;

  return (
    <li
      className={cn(
        "group flex flex-col gap-2 rounded-lg border border-border p-3",
        // One tint, not two colours: the badge already names the role.
        comment.author.isInstructor ? "bg-muted/40" : "bg-background",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary"
        >
          {initials(comment.author.name)}
        </span>

        <span className="min-w-0 truncate text-sm font-medium">{comment.author.name}</span>

        {comment.author.isInstructor && (
          <Badge variant="secondary" className="shrink-0 font-normal">
            Instructor
          </Badge>
        )}

        {showRound && comment.round && (
          <Badge variant="outline" className="shrink-0 font-normal">
            <span className="sr-only">About </span>Review {comment.round.number}
          </Badge>
        )}

        <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {formatRelative(comment.createdAt, now)}
        </span>

        {/* On hover or focus, so a long thread is not a column of bins. */}
        {comment.isMine && !withdrawn && onDelete && (
          <DeleteComment
            onConfirm={() => onDelete(comment.id)}
            pending={deleting}
            className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          />
        )}
      </div>

      {withdrawn ? (
        // It keeps its place, or the reply below answers whatever floats into the gap.
        <p className="text-sm text-muted-foreground italic">This comment was deleted.</p>
      ) : (
        <Markdown content={comment.body ?? ""} />
      )}
    </li>
  );
}

/** Withdrawing your own message, behind the confirmation shape the release dialog already uses. */
function DeleteComment({
  onConfirm,
  pending,
  className,
}: {
  onConfirm: () => void;
  pending: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete your comment"
        className={cn("size-7 shrink-0 text-muted-foreground", className)}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this comment?</DialogTitle>
          <DialogDescription>
            It stays in the conversation as a deleted message, so any reply to it still makes sense.
            Nobody will be able to read what it said.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
