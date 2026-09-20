"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { CompetencyEntryField } from "@/components/competency-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { DEVELOPMENT_MARKERS, MARKER_META, type DevelopmentMarker } from "@/lib/coaching";
import { entryById, type PickableEntry } from "@/lib/competencies";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Goal = RouterOutputs["coaching"]["myGoals"]["goals"][number];

/**
 * Setting and changing one of your own goals.
 *
 * **The whole of it is the fellow's.** They choose the competency entry, write the three parts,
 * say where they stand, and delete it when it stops being what they are working on — usually
 * agreed with an instructor in a coaching session, but nothing here waits on one or asks
 * permission. An instructor reads the result and writes none of it; if they think an assessment
 * is off the mark, they say so in the session.
 *
 * One editor for adding and changing, opened on a goal or on nothing — the shape the resource
 * dialog and the notes dialog already use, inline rather than in a dialog because the guiding
 * questions are the point and a cramped modal buries them.
 */
export function GoalEditor({
  programId,
  goal,
  onDone,
}: {
  programId: string;
  /** The goal being changed, or null to set a new one. */
  goal: Goal | null;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [entry, setEntry] = React.useState<PickableEntry | null>(
    goal === null ? null : entryOfGoal(goal),
  );
  const [successCriteria, setSuccessCriteria] = React.useState(goal?.successCriteria ?? "");
  const [objectives, setObjectives] = React.useState(goal?.objectives ?? "");
  const [actionPlan, setActionPlan] = React.useState(goal?.actionPlan ?? "");
  const [marker, setMarker] = React.useState<DevelopmentMarker | null>(goal?.marker ?? null);

  const set = useMutation(
    trpc.coaching.setGoal.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Goal set.");
          onDone();
        },
      }),
    ),
  );
  const update = useMutation(
    trpc.coaching.updateGoal.mutationOptions(settled({ onSuccess: onDone })),
  );
  const remove = useMutation(
    trpc.coaching.deleteGoal.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Goal removed.");
          onDone();
        },
      }),
    ),
  );

  const busy = set.isPending || update.isPending || remove.isPending;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (entry === null || busy) return;

    const fields = { entryId: entry.entryId, successCriteria, objectives, actionPlan, marker };
    if (goal === null) {
      set.mutate({ programId, ...fields });
    } else {
      update.mutate({ programId, goalId: goal.id, ...fields });
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <CompetencyEntryField value={entry} onChange={setEntry} />

      <Part
        label="What does success look like?"
        hint="What would change in your daily experience if you improved at this? How will you know you have made progress?"
        value={successCriteria}
        onChange={setSuccessCriteria}
      />
      <Part
        label="Objectives"
        hint="What skills, habits or mindsets would help you get there? What do you want to be doing differently in a few weeks?"
        value={objectives}
        onChange={setObjectives}
      />
      <Part
        label="Action plan"
        hint="Before the next coaching session, what will you do — resources to review, reflections to write, people to ask?"
        value={actionPlan}
        onChange={setActionPlan}
      />

      <div className="flex flex-col gap-1.5">
        <Label className="text-sm font-medium">Where are you with this right now?</Label>
        <MarkerSelect value={marker} onChange={setMarker} />
        <p className="text-xs text-muted-foreground">
          Your own read on it, to talk through with your instructor. Move it whenever it changes.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {goal !== null && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => remove.mutate({ programId, goalId: goal.id })}
            className="mr-auto text-destructive hover:text-destructive"
          >
            Remove this goal
          </Button>
        )}
        <Button type="button" variant="ghost" disabled={busy} onClick={onDone} className="ml-auto">
          Cancel
        </Button>
        <Button type="submit" disabled={entry === null || busy}>
          {goal === null ? "Set goal" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

/** The button that opens an empty editor, and the editor when it is open. */
export function AddGoal({ programId }: { programId: string }) {
  const [open, setOpen] = React.useState(false);

  if (open) return <GoalEditor programId={programId} goal={null} onDone={() => setOpen(false)} />;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="self-start"
      onClick={() => setOpen(true)}
      data-icon="inline-start"
    >
      <Plus aria-hidden />
      Set a goal
    </Button>
  );
}

/**
 * The stored copies as a field value: what the fellow chose, in the words it carried at the time,
 * whatever the competency list says now.
 */
function entryOfGoal(goal: Goal): PickableEntry {
  const current = entryById(goal.entryId);
  return {
    entryId: goal.entryId,
    kind: goal.entryKind,
    text: goal.entryText,
    competencyName: goal.competencyName,
    competencyId: current?.competencyId ?? "",
    group: current?.group ?? "DURABLE_SKILLS",
  };
}

function Part({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        maxLength={10_000}
      />
    </div>
  );
}

const NOT_ASSESSED = "NOT_ASSESSED";

/** The marker as a select, with "Not yet" standing for null. */
function MarkerSelect({
  value,
  onChange,
}: {
  value: DevelopmentMarker | null;
  onChange: (marker: DevelopmentMarker | null) => void;
}) {
  const items = {
    [NOT_ASSESSED]: "Not yet placed",
    ...Object.fromEntries(DEVELOPMENT_MARKERS.map((marker) => [marker, MARKER_META[marker].label])),
  };

  return (
    <Select
      value={value ?? NOT_ASSESSED}
      onValueChange={(next) =>
        next && onChange(next === NOT_ASSESSED ? null : (next as DevelopmentMarker))
      }
      items={items}
    >
      <SelectTrigger className="w-56" aria-label="Where you are with this goal">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
