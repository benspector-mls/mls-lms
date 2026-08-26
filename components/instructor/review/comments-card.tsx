"use client";

import { MessagesSquare } from "lucide-react";
import * as React from "react";

import { CommentComposer } from "@/components/comments/comment-composer";
import { CommentThread } from "@/components/comments/comment-thread";
import { ResolveQuestionButton } from "@/components/comments/resolve-button";
import type { Thread } from "@/components/comments/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The conversation about one fellow's work.
 *
 * A sibling of `DraftBody` rather than a branch of it, so it is reachable in every state that
 * machine has — including the two where a question is likeliest and there is no draft at all.
 *
 * It tracks nothing read: instructors get no unread count, because their signal is the questions
 * list on triage. That the card can sit below a long report is answered by the header badge.
 */
export function CommentsCard({
  assignmentId,
  studentId,
  studentName,
  thread,
  loading,
  error,
  onRetry,
  now,
}: {
  assignmentId: string;
  studentId: string;
  studentName: string;
  thread: Thread | undefined;
  loading: boolean;
  error: boolean;
  onRetry?: () => void;
  now: Date;
}) {
  const [draft, setDraft] = React.useState("");
  const [announcement, setAnnouncement] = React.useState("");

  const count = thread?.comments.length ?? 0;

  return (
    <Card id={`comments-${studentId}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <MessagesSquare className="size-4 text-muted-foreground" />
            Conversation
            {count > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </CardTitle>

          {/*
            Offered while a question is standing, and again as a way back once it is settled — but
            not on a thread nobody is waiting on, where it would be a control with nothing to do.
          */}
          {thread?.submissionId && (thread.awaitsReply || thread.resolvedAt !== null) && (
            <ResolveQuestionButton
              submissionId={thread.submissionId}
              resolved={thread.resolvedAt !== null}
            />
          )}
        </div>

        {thread?.resolvedAt !== null && thread?.resolvedAt !== undefined && (
          <CardDescription>
            Marked as resolved, so it is off the questions list on your triage screen. Anything this
            fellow writes from now on puts it back.
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <CommentThread
          thread={thread}
          loading={loading}
          error={error}
          onRetry={onRetry}
          now={now}
          assignmentId={assignmentId}
          studentId={studentId}
          emptyTitle="Nothing has been said yet"
          emptyDescription={`Anything you write here is visible to ${studentName}, and to the rest of their team where the work is a team's.`}
          announcement={announcement}
        />

        <CommentComposer
          assignmentId={assignmentId}
          studentId={studentId}
          value={draft}
          onValueChange={setDraft}
          onPosted={() => setAnnouncement("Reply posted.")}
          label="Reply"
          placeholder="Answer their question…"
          submitLabel="Reply"
        />
      </CardContent>
    </Card>
  );
}
