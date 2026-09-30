"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { CheckLevelDots } from "@/components/status-badge";
import { TestStudentBadge } from "@/components/test-student-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { CATEGORY_LABEL, type CheckCategory } from "@/lib/checks/levels";
import { displayNameOf } from "@/lib/people";
import { formatDateTime, formatRelative } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Data = RouterOutputs["checks"]["attemptsFor"];
type Summary = NonNullable<Data["check"]["summary"]>;

/**
 * What the room's answers have in common, written by Claude at an instructor's request.
 *
 * **Between the counts and the table**, because it is the sentence the counts cannot say: the
 * overview above says how many are Blocked, and this says what the blocked answers share and
 * which part of the lesson to return to. First the themes, one list per level; then the failure
 * modes, each with the fellows whose answers show it and what to return to. The fellows are looked
 * up by id in the rows the page holds — every row, whichever cohort the table is narrowed to,
 * because the summary reads every fellow's answers — so a fellow who has since left the roster is
 * still accounted for without a name.
 *
 * **Instructor-only, and the card says so.** A summary that cites fellows by name is a synthesis
 * about people, and nothing here has a path to a fellow's screen.
 */

const THEME_KEY = { 3: "level3", 2: "level2", 1: "level1" } as const satisfies Record<
  CheckCategory,
  keyof Summary["themes"]
>;
export function CheckSummary({
  checkId,
  summary,
  summaryAt,
  rows,
  now,
}: {
  checkId: string;
  summary: Summary | null;
  summaryAt: Date | null;
  rows: Data["rows"];
  now: Date;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const summarize = useMutation(
    trpc.checks.summarize.mutationOptions(
      settled({
        onSuccess: () => toast.success("Summary written. Nothing here reaches a fellow."),
      }),
    ),
  );

  const answered = rows.filter((row) => row.attempts.length > 0).length;
  const figures = React.useMemo(() => {
    if (!summaryAt) return null;
    let read = 0;
    let since = 0;
    const readFellows = new Set<string>();
    for (const row of rows) {
      for (const attempt of row.attempts) {
        if (attempt.submittedAt > summaryAt) since += 1;
        else {
          read += 1;
          readFellows.add(row.student.id);
        }
      }
    }
    return { read, fellows: readFellows.size, since };
  }, [rows, summaryAt]);

  const button = (
    <Button
      type="button"
      size="sm"
      variant={summary ? "outline" : "default"}
      disabled={summarize.isPending || answered === 0}
      title={answered === 0 ? "Nobody has answered this check yet." : undefined}
      onClick={() => summarize.mutate({ checkId })}
    >
      {summarize.isPending ? (
        <Loader2 data-icon="inline-start" className="animate-spin" />
      ) : (
        <Sparkles data-icon="inline-start" />
      )}
      {summarize.isPending
        ? "Reading the answers…"
        : summary
          ? "Summarize again"
          : "Summarize the answers"}
    </Button>
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-sm font-medium">What the answers have in common</span>
            <span className="text-xs text-muted-foreground">
              Written by Claude for instructors, from every fellow&apos;s answers. Fellows never see
              it.
            </span>
          </div>
          {!summary && button}
        </div>

        {summary ? (
          <>
            <ul className="flex flex-col gap-2.5 text-sm">
              {([3, 2, 1] as const).map((category) => {
                const themes = summary.themes[THEME_KEY[category]];
                return (
                  <li key={category} className="flex flex-col gap-1">
                    <span className="flex items-center gap-2 font-medium">
                      <CheckLevelDots category={category} />
                      Level {category} answers · {CATEGORY_LABEL[category]}
                    </span>
                    {themes.length > 0 ? (
                      <ul className="ml-5 list-disc space-y-0.5 pl-4">
                        {themes.map((theme, index) => (
                          <li key={index}>{theme}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="ml-9 text-xs text-muted-foreground">
                        No answers at this level.
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {summary.failureModes.length > 0 && (
              <ol className="flex flex-col gap-3">
                {summary.failureModes.map((mode, index) => (
                  <li
                    key={index}
                    className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/20 p-3 text-sm"
                  >
                    <span className="font-medium">{mode.title}</span>
                    <p className="text-muted-foreground">{mode.evidence}</p>
                    <FellowNames ids={mode.fellowIds} rows={rows} />
                    <p>
                      <span className="font-medium">Return to: </span>
                      {mode.revisit}
                    </p>
                  </li>
                ))}
              </ol>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              {summaryAt && figures && (
                <p className="text-xs text-muted-foreground">
                  Written{" "}
                  <span title={formatDateTime(summaryAt)}>{formatRelative(summaryAt, now)}</span>{" "}
                  from {figures.read} {figures.read === 1 ? "answer" : "answers"} by{" "}
                  {figures.fellows} {figures.fellows === 1 ? "fellow" : "fellows"}
                  {figures.since > 0 && (
                    <>
                      {" "}
                      · <span className="font-medium text-foreground">
                        {figures.since}
                      </span> new {figures.since === 1 ? "answer" : "answers"} since
                    </>
                  )}
                </p>
              )}
              {button}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {answered === 0
              ? "Nobody has answered this check yet."
              : "No summary of the answers yet."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** The fellows a failure mode cites, by name, from the rows the page holds. */
function FellowNames({ ids, rows }: { ids: string[]; rows: Data["rows"] }) {
  if (ids.length === 0) return null;
  const byId = new Map(rows.map((row) => [row.student.id, row.student]));

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      {ids.map((id, index) => {
        const student = byId.get(id);
        return (
          <span key={id} className="inline-flex items-center gap-1">
            <span className="font-medium text-foreground">
              {student ? displayNameOf(student, "Fellow") : "A fellow no longer enrolled"}
            </span>
            {student?.testStudentNumber !== null && student !== undefined && <TestStudentBadge />}
            {index < ids.length - 1 && <span aria-hidden="true">,</span>}
          </span>
        );
      })}
    </p>
  );
}
