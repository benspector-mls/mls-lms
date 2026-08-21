"use client";

/**
 * The rounds that came before this one.
 *
 * A discarded round never reached anybody, so it is not previous feedback and is not listed here —
 * the caller decides that, and this draws what it is given.
 */

import { ChevronDown, History } from "lucide-react";
import { DraftStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatRelative, shortSha } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Draft, effectiveScore } from "@/components/instructor/review/shared";
/**
 * Every round this submission has been through, newest first.
 *
 * **Rounds, not runs.** A run is something the pipeline does — the tests execute, the model
 * reads the work — and only some rounds are that. A grade written by hand, and a correction
 * copied from the round before it, are rounds of feedback that no run produced, so naming the
 * list after runs described the minority of what is in it.
 *
 * The current round is listed too, marked as such. It is shown in full in the card above, and
 * what this adds for it is its place in the sequence.
 */
export function DraftHistory({
  drafts,
  activeId,
  now,
}: {
  drafts: Draft[];
  activeId: string | undefined;
  now: Date;
}) {
  return (
    <Collapsible className="rounded-lg border border-border bg-card">
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium">
        <span className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          Previous feedback ({drafts.length})
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2 border-t border-border p-3">
          {drafts.map((entry) => {
            const earned = entry.sections.reduce((sum, s) => sum + (effectiveScore(s) ?? 0), 0);
            const possible = entry.sections.reduce((sum, s) => sum + (s.scorePossible ?? 0), 0);

            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
                  entry.id === activeId
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-muted/20",
                )}
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <DraftStatusBadge status={entry.status} />
                    {entry.id === activeId && (
                      <Badge variant="secondary" className="font-normal">
                        Most recent
                      </Badge>
                    )}
                  </div>
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
                {possible > 0 && (
                  <span className="text-sm font-medium tabular-nums">
                    {earned}
                    <span className="text-muted-foreground"> / {possible}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
