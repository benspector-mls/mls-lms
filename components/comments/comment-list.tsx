"use client";

import { cn } from "@/lib/utils";

import { CommentItem } from "./comment-item";
import type { Comment } from "./types";

/**
 * A run of messages, oldest first. An ordered list, because the order is the meaning: a reply
 * answers the message above it.
 */
export function CommentList({
  comments,
  now,
  onDelete,
  deletingId = null,
  showRound = true,
  className,
}: {
  comments: readonly Comment[];
  now: Date;
  onDelete?: (commentId: string) => void;
  deletingId?: string | null;
  showRound?: boolean;
  className?: string;
}) {
  return (
    <ol className={cn("flex list-none flex-col gap-3", className)}>
      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          now={now}
          onDelete={onDelete}
          deleting={deletingId === comment.id}
          showRound={showRound}
        />
      ))}
    </ol>
  );
}
