import { MessageSquare } from "lucide-react";

import { EmptyState } from "@/components/list-states";
import { Markdown } from "@/components/markdown";
import { formatDate } from "@/lib/status";
import type { RouterOutputs } from "@/trpc/types";

type Transcripts = RouterOutputs["tutor"]["transcripts"];

/**
 * The Tutor tab of a fellow's record: every conversation they have had with the Tutor, most
 * recent first, each closed on arrival and opening to its turns.
 *
 * Closed rather than open, because a term's worth of conversations is long and an instructor
 * comes to read one: the one about the assignment they are grading, or the course a fellow said
 * they found hard. The line each closes to says what it is about and when it was last used.
 */
export function StudentTutor({ transcripts }: { transcripts: Transcripts }) {
  return (
    <section id="conversations" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Conversations</h2>
      {transcripts.length === 0 ? (
        <EmptyState
          icon={<MessageSquare />}
          title="No conversations yet"
          description="What this fellow asks the Tutor, and what it answers, appears here."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {transcripts.map((conversation) => (
            <li key={conversation.key}>
              <details className="group rounded-lg border border-border">
                <summary className="flex cursor-pointer flex-col gap-0.5 px-4 py-3 marker:content-none">
                  <span className="font-medium">
                    {conversation.kind === "course"
                      ? `${conversation.title} lessons`
                      : `Assignment: ${conversation.title}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {conversation.kind === "assignment" && `${conversation.courseName} · `}
                    {conversation.turns.length} messages · last on {formatDate(conversation.lastAt)}
                  </span>
                </summary>
                <ol className="flex flex-col gap-3 border-t border-border px-4 py-3">
                  {conversation.turns.map((turn) =>
                    turn.role === "USER" ? (
                      <li key={turn.id} className="flex justify-end">
                        <div className="max-w-[85%] rounded-lg bg-sky-500/10 px-3 py-2">
                          <Markdown className="text-sm" content={turn.content} />
                        </div>
                      </li>
                    ) : (
                      <li key={turn.id}>
                        <Markdown className="text-sm" content={turn.content} />
                      </li>
                    ),
                  )}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
