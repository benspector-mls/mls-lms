"use client";

/**
 * The rounds that came before this one.
 *
 * A discarded round never reached anybody, so it is not previous feedback and is not listed here —
 * the caller decides that, and this draws what it is given.
 */

import { ChevronDown, History } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatRelative, shortSha } from "@/lib/status";
import { ReleasedSection } from "@/components/instructor/review/draft-body";
import { Draft, effectiveScore } from "@/components/instructor/review/shared";
/**
 * The rounds released before the one on screen, newest first — each one openable to read what
 * the student was actually sent, drawn by the same `ReleasedSection` the released card uses.
 *
 * **Rounds, not runs.** A run is something the pipeline does — the tests execute, the model
 * reads the work — and only some rounds are that. A grade written by hand, and a correction
 * copied from the round before it, are rounds of feedback that no run produced, so naming the
 * list after runs described the minority of what is in it.
 *
 * Never the current round. That one is shown in full in the card above, and a round still being
 * read or written is not previous feedback — the caller decides this, and this draws what it is
 * given.
 */
export function DraftHistory({ drafts, now }: { drafts: Draft[]; now: Date }) {
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
                    {entry.sections.map((section, index) => (
                      <ReleasedSection key={section.id} section={section} first={index === 0} />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
