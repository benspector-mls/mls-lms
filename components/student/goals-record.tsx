"use client";

import { ChevronDown, ChevronRight, Target } from "lucide-react";
import * as React from "react";

import { CoachingSnapshotPanel } from "@/components/coaching-snapshot-panel";
import { GoalUpdates } from "@/components/goal-updates";
import { EmptyState } from "@/components/list-states";
import { AddGoal, GoalEditor } from "@/components/student/goal-editor";
import { GoalMarkerBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseSnapshot } from "@/lib/coaching";
import type { CompetencyGroup } from "@/lib/competencies";
import { formatDate } from "@/lib/status";
import type { RouterOutputs } from "@/trpc/types";

type Data = RouterOutputs["coaching"]["myGoals"];

/**
 * A fellow's own goals and coaching history: everything of coaching that is theirs to read.
 *
 * **The goals are the fellow's to keep.** They set them, rewrite them, say where they stand on
 * them and remove them — usually agreed with an instructor in a coaching session, but nothing
 * here waits on one. An instructor sees every goal the moment it exists and writes none of it; if
 * they think an assessment is off the mark, they say so in the session.
 *
 * The competency wording on a goal is the copy made when it was chosen, so later edits to the
 * competency list never rewrite what somebody set out to work on. Each completed session
 * contributes one dated snapshot of where things stood that day; those figures are a record of
 * that conversation rather than a live standing, which the dates are there to say.
 *
 * **A client component, unlike the attendance record it sits beside**, because the goals are rows
 * that open: a fellow scanning "what am I working on" wants the list, and the plan behind one goal
 * is a paragraph they read when they mean to. The page above it still fetches on the server.
 */
export function GoalsRecord({
  data,
  groups,
}: {
  data: Data;
  /** The competencies this fellow may build a goal on, fetched beside their goals. */
  groups: readonly CompetencyGroup[];
}) {
  if (data.goals.length === 0 && data.sessions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={<Target />}
          title="No goals yet"
          description="Set a goal for something you want to get better at — a skill to build, or a habit to break. Your instructor sees it and can talk it through with you in a coaching session."
        />
        <AddGoal programId={data.program.id} groups={groups} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">Your goals · {data.goals.length}</h2>
          <p className="text-xs text-muted-foreground">
            Yours to set and change whenever you like. Your instructors can see them, which is what
            makes them worth talking through in a coaching session.
          </p>
        </div>

        {data.goals.length > 0 && (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {data.goals.map((goal) => (
              <GoalRow key={goal.id} goal={goal} programId={data.program.id} groups={groups} />
            ))}
          </ul>
        )}

        <AddGoal programId={data.program.id} groups={groups} />
      </section>

      {data.sessions.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-medium">Coaching history · {data.sessions.length}</h2>
            <p className="text-xs text-muted-foreground">
              Where things stood at the end of each coaching session — a record of that day, not a
              live figure.
            </p>
          </div>

          <ul className="flex flex-col gap-3">
            {data.sessions.map((session) => {
              const snapshot = parseSnapshot(session.snapshot);
              return (
                <li
                  key={session.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-4"
                >
                  <span className="text-xs font-medium text-muted-foreground">
                    {session.endedAt === null ? "" : formatDate(session.endedAt)}
                  </span>
                  {snapshot === null ? (
                    <p className="text-sm text-muted-foreground">
                      The record of this session cannot be shown.
                    </p>
                  ) : (
                    <CoachingSnapshotPanel snapshot={snapshot} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * One goal, closed to what it is and open to the plan behind it.
 *
 * Closed shows the goal in the fellow's own words, the competency it is about if it is about one,
 * and where they say they stand — enough to answer "what am I working on" down a list. Open adds
 * the three parts of the plan, the updates they have written under it, when it was set, and the
 * way to change any of it.
 *
 * The whole row is the trigger, because on a list where every row opens, a chevron nobody hits is
 * the failure mode. Editing is a button inside the opened row rather than a second thing to hit
 * on the row itself, so opening a goal to read it cannot turn into opening it to change it.
 */
function GoalRow({
  goal,
  programId,
  groups,
}: {
  goal: Data["goals"][number];
  programId: string;
  groups: readonly CompetencyGroup[];
}) {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const hasPlan = goal.successCriteria !== "" || goal.objectives !== "" || goal.actionPlan !== "";

  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-3 text-left transition-colors hover:bg-muted/50"
      >
        {open ? (
          <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium">{goal.title}</span>
          {goal.entryText !== null && (
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">{goal.competencyName}</span>
              <span>“{goal.entryText}”</span>
              {goal.entryKind === "PITFALL" && (
                <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                  Working away from a pitfall
                </Badge>
              )}
            </span>
          )}
        </span>

        <GoalMarkerBadge marker={goal.marker} className="mt-0.5 shrink-0" />
      </button>

      {open && editing && (
        <div className="px-3 pb-3 pl-9">
          <GoalEditor
            programId={programId}
            groups={groups}
            goal={goal}
            onDone={() => setEditing(false)}
          />
        </div>
      )}

      {open && !editing && (
        <div className="flex flex-col gap-3 px-3 pb-3 pl-9">
          {goal.successCriteria !== "" && (
            <GoalPart label="What success looks like" text={goal.successCriteria} />
          )}
          {goal.objectives !== "" && (
            <GoalPart label="Skills, Habits, & Mindsets" text={goal.objectives} />
          )}
          {goal.actionPlan !== "" && <GoalPart label="Action plan" text={goal.actionPlan} />}
          {!hasPlan && (
            <p className="text-sm text-muted-foreground">
              You have not written a plan beside this one yet.
            </p>
          )}
          <GoalUpdates goal={goal} programId={programId} editable />

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">Set {formatDate(goal.createdAt)}</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setEditing(true)}
              className="ml-auto"
            >
              Edit goal
            </Button>
          </div>
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
