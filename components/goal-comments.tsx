"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { shownInPlace, useServerMutation } from "@/hooks/use-server-mutation";
import { GOAL_COMMENT_MAX_LENGTH } from "@/lib/coaching";
import { displayNameOf } from "@/lib/people";
import { formatDateTime } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

type Goal = RouterOutputs["coaching"]["myGoals"]["goals"][number];
type Comment = Goal["comments"][number];

/**
 * The conversation under one goal: a coach asking for a timeframe, the fellow answering, a coach
 * replying — in the order it was written, with the side each message came from.
 *
 * **One component for both sides, and both sides write.** The fellow sees it inside an opened
 * goal on their Goals page; an instructor sees it inside the same goal on the record's Coaching
 * tab and on the session form. Both call the same two procedures, `postGoalComment` and
 * `withdrawGoalComment`, which decide for themselves which side the caller is on; `side` here
 * changes only the words around the thread, never what it may do.
 *
 * **"New" is the fellow's alone.** Each goal carries the fellow's receipt (`commentsReadAt`), and
 * an instructor comment newer than it is marked. Opening the goal is reading it: this component
 * mounts when the row opens, and the effect below moves the receipt to the newest such comment —
 * invalidating only the sidebar's count, so the labels stay while the fellow reads and are gone on
 * the next visit.
 *
 * A withdrawn comment keeps its place and loses its words, the submission thread's rule, so a
 * reply beneath it still answers something.
 */
export function GoalComments({
  goal,
  programId,
  side,
}: {
  goal: Goal;
  programId: string;
  side: "fellow" | "instructor";
}) {
  const [writing, setWriting] = React.useState(false);
  const standing = goal.comments.filter((comment) => !comment.withdrawn);

  const isNew = (comment: Comment) =>
    side === "fellow" &&
    comment.authorRole === "INSTRUCTOR" &&
    !comment.withdrawn &&
    (goal.commentsReadAt === null || comment.createdAt > goal.commentsReadAt);
  const unread = goal.comments.filter(isNew);

  useMarkGoalCommentsRead({
    programId,
    goalId: goal.id,
    upTo: unread.at(-1)?.id ?? null,
  });

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Comments · {standing.length}
          </span>
          {!writing && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setWriting(true)}
              data-icon="inline-start"
            >
              <MessageSquare aria-hidden />
              Write a comment
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {side === "fellow"
            ? "Your coaches can write here, and you can reply."
            : "They see these and can reply."}
        </p>
      </div>

      {goal.comments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {goal.comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              programId={programId}
              isNew={isNew(comment)}
            />
          ))}
        </ul>
      )}

      {writing && (
        <CommentEditor
          programId={programId}
          goalId={goal.id}
          side={side}
          onDone={() => setWriting(false)}
        />
      )}
    </section>
  );
}

/** One message as it reads: who, when, the words — or that they were withdrawn. */
function CommentItem({
  comment,
  programId,
  isNew,
}: {
  comment: Comment;
  programId: string;
  isNew: boolean;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const withdraw = useMutation(
    trpc.coaching.withdrawGoalComment.mutationOptions(
      settled({ onSuccess: () => toast.success("Comment withdrawn.") }),
    ),
  );

  const who = comment.mine
    ? "You"
    : comment.author
      ? displayNameOf(comment.author, "Somebody")
      : comment.authorRole === "INSTRUCTOR"
        ? "A former instructor"
        : "A former fellow";

  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-border p-3",
        comment.authorRole === "INSTRUCTOR" ? "bg-muted/20" : "bg-background",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{who}</span>
        <span className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
        {isNew && (
          <Badge variant="outline" className="font-normal text-emerald-700 dark:text-emerald-300">
            New
          </Badge>
        )}
        {comment.mine && !comment.withdrawn && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate({ programId, commentId: comment.id })}
            className="ml-auto text-destructive hover:text-destructive"
          >
            Withdraw
          </Button>
        )}
      </div>

      {comment.withdrawn ? (
        <p className="text-sm text-muted-foreground">Withdrawn.</p>
      ) : (
        <Markdown content={comment.body} />
      )}
    </li>
  );
}

/** Writing one message: a box, Post, Cancel. No preview and no files — these are short. */
function CommentEditor({
  programId,
  goalId,
  side,
  onDone,
}: {
  programId: string;
  goalId: string;
  side: "fellow" | "instructor";
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [body, setBody] = React.useState("");

  const post = useMutation(
    trpc.coaching.postGoalComment.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Comment posted.");
          onDone();
        },
        onError: shownInPlace,
      }),
    ),
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (body.trim() === "" || post.isPending) return;
    post.mutate({ programId, goalId, body });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
    >
      <MarkdownEditor
        autoFocus
        value={body}
        onChange={setBody}
        ariaLabel="Comment"
        rows={3}
        maxLength={GOAL_COMMENT_MAX_LENGTH}
        placeholder={
          side === "fellow"
            ? "Reply to your coach, or ask a question about this goal."
            : "A question, a suggestion, a nudge. They see it and can reply."
        }
      />

      {post.error && (
        <p className="text-sm text-destructive" role="alert">
          {post.error.message}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={post.isPending} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={body.trim() === "" || post.isPending}>
          {post.isPending ? "Posting…" : "Post"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Opening the goal is reading its comments: once, on mount, when there is something unread.
 *
 * A ref guards it rather than `isPending`, because the effect can run again before the request
 * settles — the thread's `useMarkThreadRead` makes the same choice. Only the sidebar's count is
 * invalidated afterwards: the page is not refreshed, so the "New" labels drawn from the payload
 * stay while the fellow reads and are gone the next time they come.
 */
function useMarkGoalCommentsRead(params: {
  programId: string;
  goalId: string;
  upTo: string | null;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const mark = useMutation(
    trpc.coaching.markGoalCommentsRead.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.coaching.unreadGoalComments.queryKey(),
        });
      },
      onError: shownInPlace,
    }),
  );

  const marked = React.useRef(false);
  const { programId, goalId, upTo } = params;

  React.useEffect(() => {
    if (marked.current || upTo === null) return;
    marked.current = true;
    mark.mutate({ programId, goalId, upTo });
    // `mark` is stable; the ref above is what makes this run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId, goalId, upTo]);
}
