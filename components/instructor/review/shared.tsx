"use client";

/**
 * What every part of the review screen shares: the two contexts, the shapes it reads, and the
 * few helpers more than one card asks.
 *
 * Extracted when `grading-review.tsx` was split. It holds what two or more of those files need
 * and nothing else — a piece used in one place belongs beside its one caller, not here.
 */

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Card, CardContent } from "@/components/ui/card";
import { composeRound, type ReportSection } from "@/lib/grade/report-text";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

export type QueueSubmission =
  RouterOutputs["submissions"]["listForAssignment"]["submissions"][number];
export type DraftList = RouterOutputs["gradingDrafts"]["listForSubmission"];
export type Draft = DraftList["drafts"][number];
export type Section = Draft["sections"][number];
/** One section as the assignment declares it, which the editor draws before a round exists. */
export type DeclaredSection = DraftList["handSections"][number];

/** An instructor's edit where there is one, the model's output where there is not. */
export function effectiveScore(section: Section): number | null {
  return section.editedScoreEarned ?? section.scoreEarned;
}
export function effectiveReport(section: Section): string | null {
  return section.editedReportMarkdown ?? section.reportMarkdown;
}
export function effectiveSummary(draft: Draft): string | null {
  return draft.editedSummaryMarkdown ?? draft.summaryMarkdown;
}

/**
 * The key a section is held under in the editor: the declared section's key, or for a section
 * written before sections had keys the type it stored, which is the one identity it holds.
 */
export function sectionKeyOf(section: { sectionKey: string | null; sectionType: string }): string {
  return section.sectionKey ?? section.sectionType;
}

/** True for a round whose sections are scored units: every section carries a declared key. */
export function isKeyedRound(draft: { sections: { sectionKey: string | null }[] }): boolean {
  return draft.sections.length > 0 && draft.sections.every((s) => s.sectionKey !== null);
}

/**
 * The comment a keyed round posts, as the student will read it, from the round's effective
 * values. A heading is the section's own, with the declaration's, by key, for a round stored
 * before sections carried theirs.
 */
export function roundDocument(draft: Draft, declared: readonly DeclaredSection[]): string {
  const headingOf = new Map(declared.map((unit) => [unit.key, unit.heading]));
  const sections: ReportSection[] = draft.sections.map((section) => ({
    label: section.label ?? section.sectionType,
    heading:
      section.heading ??
      (section.sectionKey === null ? null : (headingOf.get(section.sectionKey) ?? null)),
    type: section.sectionType,
    scoreEarned: effectiveScore(section),
    scorePossible: section.scorePossible ?? 0,
    feedbackMarkdown: effectiveReport(section) ?? "",
  }));
  return composeRound({ summaryMarkdown: effectiveSummary(draft) ?? "", sections });
}

/**
 * The address of the feedback comment a round posted to the pull request, or null when there is
 * no such comment to open.
 *
 * GitHub addresses one comment on a pull request by the pull request's own address followed by
 * `#issuecomment-` and the comment's numeric id, and opening that address scrolls the page to
 * the comment and highlights it. Both parts are already recorded: approval saves the id on the
 * draft, and the submission holds the pull request's address — so the link costs no request to
 * GitHub and no new column.
 *
 * Null for a hand-graded document or upload, which has no pull request, and for a round whose
 * comment never posted, which has no id. The second case is what the "never posted" alert and
 * its retry button exist for, so a link would be the wrong thing to show there.
 */
export function postedCommentUrl(
  submission: { prUrl: string | null },
  draft: { postedPrCommentId: bigint | null },
): string | null {
  if (submission.prUrl === null || draft.postedPrCommentId === null) return null;
  return `${submission.prUrl}#issuecomment-${draft.postedPrCommentId}`;
}

/**
 * "Ana, Ben, Chi and Dev" — a list a person reads rather than one a program prints.
 *
 * Its own function because the armed release button's caption is the one place the whole team is
 * spelled out, and a comma-joined list there would read as data at the moment somebody is being
 * asked to check it.
 */
export function listNames(members: { displayName: string | null; email: string | null }[]): string {
  const names = members.map((member) => member.displayName ?? member.email ?? "Unknown");
  if (names.length <= 1) return names[0] ?? "Nobody";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function StateCard({
  icon: Icon,
  title,
  description,
  tone = "neutral",
  spin = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  tone?: "neutral" | "warning" | "success";
  spin?: boolean;
  children?: React.ReactNode;
}) {
  const toneClass =
    tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className={cn("size-6", toneClass, spin && "animate-spin")} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium">{title}</p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Runs the pipeline. Awaited inside the request and slow — tens of seconds to a couple of
 * minutes — so the button says what is happening rather than going quiet.
 */
export function useGenerateReport() {
  const trpc = useTRPC();
  const settled = useServerMutation();

  return useMutation(
    trpc.gradingDrafts.generate.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Report generated. Nothing has been sent to the student.");
        },
      }),
    ),
  );
}
