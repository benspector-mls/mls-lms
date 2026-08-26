"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import * as React from "react";

import { EmptyState, ErrorState, ListSkeleton } from "@/components/list-states";
import { shownInPlace } from "@/hooks/use-server-mutation";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

import { CommentList } from "./comment-list";
import type { Thread } from "./types";

/**
 * The conversation, with its loading, empty, and error states.
 *
 * The composer is a sibling the caller places, because the two screens put it in different places:
 * the fellow's panel holds it at the foot of a sheet, the instructor's card stacks it underneath.
 *
 * The live region is here rather than in the composer so only one exists. It announces a post and
 * is never the list itself, which a refetch would re-announce entirely.
 */
export function CommentThread({
  thread,
  loading,
  error,
  onRetry,
  now,
  assignmentId,
  studentId,
  emptyTitle = "No comments yet",
  emptyDescription,
  announcement,
  className,
}: {
  thread: Thread | undefined;
  loading: boolean;
  error: boolean;
  onRetry?: () => void;
  now: Date;
  assignmentId: string;
  studentId?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  announcement?: string;
  className?: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const remove = useMutation(
    trpc.submissionComments.remove.mutationOptions({
      onError: shownInPlace,
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.submissionComments.thread.queryKey({ assignmentId, studentId }),
        });
      },
    }),
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement ?? ""}
      </p>

      {loading ? (
        <ListSkeleton rows={2} />
      ) : error ? (
        <ErrorState title="Could not load the conversation" onRetry={onRetry} />
      ) : !thread || thread.comments.length === 0 ? (
        <EmptyState
          icon={<MessageSquare />}
          title={emptyTitle}
          description={emptyDescription}
          className="py-8"
        />
      ) : (
        <CommentList
          comments={thread.comments}
          now={now}
          onDelete={(commentId) => remove.mutate({ commentId })}
          deletingId={remove.isPending ? (remove.variables?.commentId ?? null) : null}
        />
      )}

      {remove.error && (
        <p role="alert" className="text-sm text-destructive">
          {remove.error.message}
        </p>
      )}
    </div>
  );
}

/**
 * Says the thread has been read as far as its newest message, once it comes into view.
 *
 * An effect rather than a button: `MarkFeedbackRead` beside it is a button because pressing that
 * takes the assignment off a dashboard, where this only clears a number.
 *
 * **Outside `useServerMutation`, which is the one place here that skips it.** That hook would
 * refresh the course page under an open sheet and refetch the thread being read. Nothing else on
 * screen depends on this write; `onRead` clears the badge locally.
 *
 * A ref rather than `isPending` guards it, because the effect can run again before the request
 * settles.
 */
export function useMarkThreadRead(params: {
  thread: Thread | undefined;
  enabled: boolean;
  onRead: () => void;
}) {
  const trpc = useTRPC();
  const mark = useMutation(
    trpc.submissionComments.markRead.mutationOptions({ onError: shownInPlace }),
  );

  const marked = React.useRef(false);
  const { thread, enabled, onRead } = params;
  const submissionId = thread?.submissionId ?? null;
  const upTo = thread?.lastCommentId ?? null;
  const unread = thread?.unreadCount ?? 0;

  React.useEffect(() => {
    if (marked.current || !enabled || unread === 0) return;
    if (!submissionId || !upTo) return;

    marked.current = true;
    mark.mutate({ submissionId, upTo });
    onRead();
    // `mark` and `onRead` are stable; the ref above is what makes this run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, unread, submissionId, upTo]);
}
