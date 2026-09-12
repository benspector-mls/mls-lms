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

export interface RubricItem {
  label: string;
  criterion: string;
  scoreEarned: number;
  scorePossible: number;
  note: string | null;
}

export function readRubricItems(value: unknown): RubricItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.label !== "string") return [];
    return [
      {
        label: row.label,
        criterion: typeof row.criterion === "string" ? row.criterion : "",
        scoreEarned: typeof row.scoreEarned === "number" ? row.scoreEarned : 0,
        scorePossible: typeof row.scorePossible === "number" ? row.scorePossible : 0,
        note: typeof row.note === "string" ? row.note : null,
      },
    ];
  });
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
