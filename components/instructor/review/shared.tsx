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
import { readReportRows, type ReportRow } from "@/lib/grade/report-text";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

export type QueueSubmission =
  RouterOutputs["submissions"]["listForAssignment"]["submissions"][number];
export type DraftList = RouterOutputs["gradingDrafts"]["listForSubmission"];
export type Draft = DraftList["drafts"][number];
export type Section = Draft["sections"][number];

/** An instructor's edit where there is one, the model's output where there is not. */
export function effectiveScore(section: Section): number | null {
  return section.editedScoreEarned ?? section.scoreEarned;
}
export function effectiveReport(section: Section): string | null {
  return section.editedReportMarkdown ?? section.reportMarkdown;
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

/** The summary and rows an instructor edits on a report the application assembles from them. */
export type ReportParts = { summaryMarkdown: string; rows: ReportRow[] };

/**
 * A model-generated section's parts, the instructor's where they have edited and the model's
 * where they have not. Null for a section written as one block of text — a hand grade, a
 * correction, or a report generated before reports had rows — which is edited as text.
 */
export function effectiveParts(section: Section): ReportParts | null {
  if (section.summaryMarkdown === null) return null;
  return {
    summaryMarkdown: section.editedSummaryMarkdown ?? section.summaryMarkdown,
    rows: readReportRows(section.editedRubricItems ?? section.rubricItems),
  };
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
