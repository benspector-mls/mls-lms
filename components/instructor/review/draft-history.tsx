"use client";

/**
 * The rounds that came before this one.
 *
 * A discarded round never reached anybody, so it is not previous feedback and is not listed here —
 * the caller decides that, and this draws what it is given.
 */

import { ChevronDown, ExternalLink, GitPullRequest } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatRelative, shortSha } from "@/lib/status";
import { ReleasedSection } from "@/components/instructor/review/draft-body";
import {
  Draft,
  QueueSubmission,
  effectiveScore,
  postedCommentUrl,
} from "@/components/instructor/review/shared";
/**
 * The rounds released before the one on screen, newest first — each one openable to read what
 * the student was actually sent, drawn by the same `ReleasedSection` the released card uses.
 *
 * **Rounds, not runs.** A run is something the pipeline does — the tests execute, the model
 * reads the work — and only some rounds are that. A grade written by hand, and a correction
 * copied from the round before it, are rounds of feedback that no run produced, so naming the
 * list after runs described the minority of what is in it.
 *
 * Never the current round. That one is shown in full on the Report tab, and a round still being
 * read or written is not previous feedback — the caller decides this, and this draws what it is
 * given.
 *
 * The rows have no wrapper around them, because the History tab's label already names the list
 * and counts it.
 */
export function DraftHistory({
  submission,
  drafts,
  now,
}: {
  /** Holds the pull request's address, which each round's link to its comment is built from. */
  submission: QueueSubmission;
  drafts: Draft[];
  now: Date;
}) {
  return (
    <div className="flex flex-col gap-2">
      {drafts.map((entry) => {
        const earned = entry.sections.reduce((sum, s) => sum + (effectiveScore(s) ?? 0), 0);
        const possible = entry.sections.reduce((sum, s) => sum + (s.scorePossible ?? 0), 0);
        const commentUrl = postedCommentUrl(submission, entry);

        return (
          /*
                Each round its own collapsible, closed on arrival: the list answers "what went
                out, when, from whom" at a glance, and opens into the full report only when an
                earlier round is the thing being checked.
              */
          <Collapsible key={entry.id} className="rounded-md border border-border bg-muted/20">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-3 py-2 text-left">
              <div className="flex flex-col">
                {/*
                      Who released this round, where a status badge used to stand. Everything in
                      this list went to the student — that is what earns a round a place here — so
                      "Approved" said nothing, and who said it is the fact worth a line.
                    */}
                <span className="text-sm font-medium">
                  {entry.approvedBy?.displayName ?? "An instructor"}
                </span>
                {/*
                      The commit only where there is one. `shortSha` renders an em dash for null,
                      which on a document or an upload gave every round in the list a dash standing
                      in for a concept those kinds do not have — absent reads as not applicable,
                      where a dash reads as missing.
                    */}
                <span className="mt-1 font-mono text-xs text-muted-foreground">
                  {entry.headSha ? `${shortSha(entry.headSha)} · ` : ""}
                  {formatRelative(entry.createdAt, now)}
                </span>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                {possible > 0 && (
                  <span className="text-sm font-medium tabular-nums">
                    {earned}
                    <span className="text-muted-foreground"> / {possible}</span>
                  </span>
                )}
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-4 border-t border-border p-3">
                {/*
                  Inside the expanded body rather than on the row, because the row is a button
                  that opens the round, and a link inside a button is a click with two meanings.
                  Each round posted its own comment, so each links to its own.
                */}
                {commentUrl && (
                  <a
                    href={commentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground underline-offset-4 hover:underline"
                  >
                    <GitPullRequest className="size-3.5" />
                    Open the comment on the pull request
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
                {entry.sections.map((section, index) => (
                  <ReleasedSection key={section.id} section={section} first={index === 0} />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
