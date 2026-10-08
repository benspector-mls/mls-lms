"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { shownInPlace, useServerMutation } from "@/hooks/use-server-mutation";
import { TOPIC_MAX_LENGTH } from "@/lib/coaching";
import { formatDate } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Topic = RouterOutputs["coaching"]["myGoals"]["topics"][number];

/**
 * The topics a fellow wants to raise at their next coaching session, in the order they wrote them.
 *
 * **The fellow's to write and nobody else's.** `editable` is true on their own Goals page and false
 * on the two instructor screens — the record's Coaching tab and a draft session form — and that one
 * flag is the whole difference: the same rows, the same dates, with the controls present or absent.
 * The fellow removes a topic once it has been talked about, which is what the caption on their page
 * says; nothing here ties a topic to a session.
 *
 * **Every row carries the date it was added**, on both sides, because that is how a coach opening
 * the record tells what is new since the last conversation from what has been sitting there.
 * Oldest first, so the list reads as it was written and what is new is at the bottom.
 *
 * Plain text rather than markdown: a topic is a line or a paragraph, and the box that writes it is
 * a `Textarea`, not an editor.
 */
export function CoachingTopics({
  topics,
  programId,
  editable,
  empty,
}: {
  topics: readonly Topic[];
  programId: string;
  editable: boolean;
  /** What to say when there are none. Each screen says it differently. */
  empty: string;
}) {
  const [adding, setAdding] = React.useState(false);

  return (
    <div className="flex flex-col gap-2">
      {topics.length === 0 ? (
        !adding && (
          <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
            {empty}
          </p>
        )
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {topics.map((topic) => (
            <TopicRow key={topic.id} topic={topic} programId={programId} editable={editable} />
          ))}
        </ul>
      )}

      {editable && adding && (
        <TopicEditor programId={programId} topic={null} onDone={() => setAdding(false)} />
      )}

      {editable && !adding && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
            data-icon="inline-start"
          >
            <Plus aria-hidden />
            Add a topic
          </Button>
        </div>
      )}
    </div>
  );
}

/** One topic as it reads: the date it was added, and the words. */
function TopicRow({
  topic,
  programId,
  editable,
}: {
  topic: Topic;
  programId: string;
  editable: boolean;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [editing, setEditing] = React.useState(false);

  const remove = useMutation(
    trpc.coaching.deleteTopic.mutationOptions(
      settled({ onSuccess: () => toast.success("Topic removed.") }),
    ),
  );

  if (editing) {
    return (
      <li className="p-3">
        <TopicEditor programId={programId} topic={topic} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-1 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Added {formatDate(topic.createdAt)}</span>
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
              onClick={() => remove.mutate({ programId, topicId: topic.id })}
              className="text-destructive hover:text-destructive"
            >
              Remove
            </Button>
          </span>
        )}
      </div>
      <p className="text-sm whitespace-pre-wrap">{topic.body}</p>
    </li>
  );
}

/** Writing a topic, or changing one: a box, Save, Cancel. */
function TopicEditor({
  programId,
  topic,
  onDone,
}: {
  programId: string;
  /** The topic being changed, or null to add one. */
  topic: Topic | null;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [body, setBody] = React.useState(topic?.body ?? "");

  const add = useMutation(
    trpc.coaching.addTopic.mutationOptions(
      settled({ onSuccess: () => onDone(), onError: shownInPlace }),
    ),
  );
  const edit = useMutation(
    trpc.coaching.editTopic.mutationOptions(
      settled({ onSuccess: () => onDone(), onError: shownInPlace }),
    ),
  );

  const busy = add.isPending || edit.isPending;
  const error = add.error?.message ?? edit.error?.message ?? null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (body.trim() === "" || busy) return;
    if (topic === null) {
      add.mutate({ programId, body });
    } else {
      edit.mutate({ programId, topicId: topic.id, body });
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
    >
      <Textarea
        autoFocus
        aria-label={topic === null ? "New topic" : "Edit topic"}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={2}
        maxLength={TOPIC_MAX_LENGTH}
        placeholder="A question, a decision, something you want help with."
      />

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={body.trim() === "" || busy}>
          {busy ? "Saving…" : topic === null ? "Add topic" : "Save"}
        </Button>
      </div>
    </form>
  );
}
