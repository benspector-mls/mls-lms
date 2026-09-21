"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";

import { GoalMarkerBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/status";
import type { RouterOutputs } from "@/trpc/types";

/**
 * A fellow's goals as an instructor reads them: rows that open onto the plan behind each one.
 *
 * **Nothing here is a control.** The goals are the fellow's — they set them, rewrite them and place
 * themselves on them — so this renders and writes nothing. An instructor who thinks an assessment
 * is off the mark says so in the coaching session.
 *
 * **One component for the two places an instructor meets them**: the Coaching tab of the student
 * record, and the session form where they are the thing being talked through. The two used to
 * print different subsets of the same goal — the record stopped at the competency and the date,
 * the form added the success criteria alone — which meant preparing for a conversation and having
 * it showed different halves of what somebody wrote.
 *
 * Closed shows what the goal is about and where they stand, which is what a list of goals is
 * scanned for. Open adds the three parts of the plan, in the fellow's own words and under the
 * headings they wrote them against, so the session form and the fellow's screen say the same
 * things in the same order. The whole row is the trigger, because on a list where every row opens,
 * a chevron nobody hits is the failure mode.
 */

type Goal = RouterOutputs["coaching"]["forStudent"]["goals"][number];

export function FellowGoals({
  goals,
  empty,
}: {
  goals: readonly Goal[];
  /** What to say when there are none. The record and the session form say it differently. */
  empty: string;
}) {
  if (goals.length === 0) {
    return (
      <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
      {goals.map((goal) => (
        <GoalCard key={goal.id} goal={goal} />
      ))}
    </ul>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const [open, setOpen] = React.useState(false);
  const hasPlan = goal.successCriteria !== "" || goal.objectives !== "" || goal.actionPlan !== "";

  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        {open ? (
          <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{goal.competencyName}</span>
            {goal.entryKind === "PITFALL" && (
              <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                Pitfall
              </Badge>
            )}
          </span>
          <span className="text-sm">“{goal.entryText}”</span>
        </span>

        <GoalMarkerBadge marker={goal.marker} className="mt-0.5 shrink-0" />
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3 pl-9">
          {goal.successCriteria !== "" && (
            <GoalPart label="What success looks like" text={goal.successCriteria} />
          )}
          {goal.objectives !== "" && (
            <GoalPart label="Skills, Habits, & Mindsets" text={goal.objectives} />
          )}
          {goal.actionPlan !== "" && <GoalPart label="Action plan" text={goal.actionPlan} />}

          {/*
            Said rather than left blank, because an empty card reads as a loading failure — and a
            goal with no plan beside it is a real thing to notice in a coaching session.
          */}
          {!hasPlan && (
            <p className="text-sm text-muted-foreground">
              They have not written a plan beside this one yet.
            </p>
          )}

          <span className="text-xs text-muted-foreground">Set {formatDate(goal.createdAt)}</span>
        </div>
      )}
    </li>
  );
}

function GoalPart({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <p className="text-sm whitespace-pre-wrap">{text}</p>
    </div>
  );
}
