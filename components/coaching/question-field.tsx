"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  isBlankAnswer,
  type AnswerValue,
  type LayoutQuestion,
  type LayoutTemperature,
} from "@/lib/coaching";
import { cn } from "@/lib/utils";

/**
 * One question of a coaching form, drawn from its layout item: the prompt, who reads the answer,
 * the caption, and the control its kind calls for — or, on a completed session, the answer as it
 * was recorded.
 *
 * **One component for every kind, on both sides.** The coach's form draws every question through
 * this, editable on a draft and read-only once completed; the fellow's coaching history draws the
 * shared ones through `AnswerReadout` below. Written once so that a scale, a choice and a yes-or-no
 * are shown the same way wherever they are read.
 *
 * **The badge beside the prompt says who reads the answer**, which is the form's whole safety
 * story: a question marked shared says so while the coach is typing, not only after.
 *
 * The temperature check is drawn here too, as the scale it has always been, bound to its own column
 * by the form rather than to an answer — see `TEMPERATURE_KIND` in lib/coaching.ts.
 */
export function QuestionField({
  item,
  value,
  completed,
  fellowName,
  onChange,
  onBlur,
}: {
  item: LayoutQuestion | LayoutTemperature;
  /** The current answer, or null where none has been given. A temperature is a number or null. */
  value: AnswerValue | null;
  completed: boolean;
  fellowName: string;
  onChange: (value: AnswerValue) => void;
  /** Flushes a text answer when the field loses focus, so a half-typed answer is not lost. */
  onBlur: () => void;
}) {
  const id = `coaching-${item.id}`;
  const shared = item.kind !== "TEMPERATURE" && item.shared;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {item.prompt}
        </Label>
        {shared ? (
          <Badge variant="outline" className="font-normal text-emerald-700 dark:text-emerald-300">
            {completed ? `Shared with ${fellowName}` : `Shared with ${fellowName} on completion`}
          </Badge>
        ) : (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            Staff only
          </Badge>
        )}
      </div>
      {item.caption && <p className="text-xs text-muted-foreground">{item.caption}</p>}
      <Control
        id={id}
        item={item}
        value={value}
        completed={completed}
        onChange={onChange}
        onBlur={onBlur}
      />
    </div>
  );
}

function Control({
  id,
  item,
  value,
  completed,
  onChange,
  onBlur,
}: {
  id: string;
  item: LayoutQuestion | LayoutTemperature;
  value: AnswerValue | null;
  completed: boolean;
  onChange: (value: AnswerValue) => void;
  onBlur: () => void;
}) {
  switch (item.kind) {
    case "SHORT_TEXT":
    case "LONG_TEXT": {
      const text = typeof value === "string" ? value : "";
      if (completed) return <Readout item={item} value={value} />;
      const common = {
        id,
        value: text,
        onBlur,
        maxLength: 20_000,
        placeholder: item.caption ? undefined : "In their words, roughly.",
      };
      return item.kind === "SHORT_TEXT" ? (
        <Input {...common} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Textarea {...common} rows={2} onChange={(event) => onChange(event.target.value)} />
      );
    }
    case "SCALE":
    case "TEMPERATURE": {
      const chosen = typeof value === "number" ? value : null;
      if (completed && chosen === null) {
        return <p className="text-sm text-muted-foreground">Not asked.</p>;
      }
      const bounds =
        item.kind === "SCALE"
          ? item
          : {
              min: TEMPERATURE_MIN,
              max: TEMPERATURE_MAX,
              lowLabel: "Feeling low",
              highLabel: "Feeling good",
            };
      return (
        <Scale
          name={id}
          min={bounds.min}
          max={bounds.max}
          lowLabel={bounds.lowLabel}
          highLabel={bounds.highLabel}
          value={chosen}
          disabled={completed}
          onChange={onChange}
        />
      );
    }
    case "SINGLE_CHOICE": {
      if (completed) return <Readout item={item} value={value} />;
      const chosen = typeof value === "string" ? value : null;
      return (
        <div role="radiogroup" aria-labelledby={id} className="flex flex-col gap-1.5">
          {item.options.map((option) => (
            <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name={id}
                value={option}
                checked={chosen === option}
                onChange={() => onChange(option)}
                className="size-4 accent-primary"
              />
              {option}
            </label>
          ))}
        </div>
      );
    }
    case "MULTIPLE_CHOICE": {
      if (completed) return <Readout item={item} value={value} />;
      const chosen = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-col gap-1.5">
          {item.options.map((option) => (
            <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={chosen.includes(option)}
                onCheckedChange={(next) =>
                  onChange(
                    next
                      ? // In the form's order, whichever order they were ticked in.
                        item.options.filter((candidate) =>
                          candidate === option ? true : chosen.includes(candidate),
                        )
                      : chosen.filter((candidate) => candidate !== option),
                  )
                }
              />
              {option}
            </label>
          ))}
        </div>
      );
    }
    case "YES_NO": {
      if (completed) return <Readout item={item} value={value} />;
      return (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            id={id}
            checked={value === true}
            onCheckedChange={(next) => onChange(next === true)}
          />
          Yes
        </label>
      );
    }
  }
}

/**
 * A recorded answer as text, for a completed session and for the fellow's coaching history: the
 * words, the chosen options, the number against its ends, or "Not discussed." where nothing was
 * written.
 */
export function AnswerReadout({
  item,
  value,
}: {
  item: LayoutQuestion;
  value: AnswerValue | null;
}) {
  return <Readout item={item} value={value} />;
}

function Readout({ item, value }: { item: LayoutQuestion; value: AnswerValue | null }) {
  if (value === null || isBlankAnswer(value)) {
    return <p className="text-sm text-muted-foreground">Not discussed.</p>;
  }
  if (typeof value === "boolean") return <p className="text-sm">{value ? "Yes" : "No"}</p>;
  if (Array.isArray(value)) {
    return (
      <ul className="flex flex-col gap-0.5 text-sm">
        {value.map((option) => (
          <li key={option}>{option}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === "number") {
    const ends =
      item.kind === "SCALE"
        ? ` on a scale of ${item.min} (${item.lowLabel}) to ${item.max} (${item.highLabel})`
        : "";
    return (
      <p className="text-sm">
        {value}
        {ends}
      </p>
    );
  }
  return <p className="text-sm whitespace-pre-wrap">{value}</p>;
}

/**
 * A scale: its points in a row, with the ends named.
 *
 * **A scale rather than a number box**, because the answer is a position between two named ends
 * and the anchors are what give a 4 its meaning. A number field asks the fellow to make that
 * translation themselves, and it accepts 0, 11, and -3 — which is why choosing a point can only
 * produce a number the question allows.
 *
 * **Native radios sharing one name**, so the arrow keys move along the scale, Tab reaches the
 * group once, and a screen reader reads it as one question with its answers — all of it the
 * platform's, none of it ours. The input is `sr-only` rather than hidden so it keeps every one of
 * those behaviours; the square beside it is what a pointer sees, and `peer-focus-visible` puts the
 * focus ring on that square when a keyboard moves the selection.
 *
 * A completed session renders the same scale, disabled: a bare "7" would drop the two anchors the
 * number was chosen against, which is most of what it meant.
 */
function Scale({
  name,
  min,
  max,
  lowLabel,
  highLabel,
  value,
  disabled,
  onChange,
}: {
  name: string;
  min: number;
  max: number;
  lowLabel: string;
  highLabel: string;
  value: number | null;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const points = Array.from({ length: max - min + 1 }, (_, index) => min + index);

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-1.5">
      <div className="w-max max-w-full flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          {points.map((point) => (
            <label key={point} className={cn(!disabled && "cursor-pointer")}>
              <input
                type="radio"
                name={name}
                value={point}
                checked={value === point}
                onChange={() => onChange(point)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-md border border-border text-sm tabular-nums transition-colors",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1",
                  "peer-checked:border-primary peer-checked:bg-primary peer-checked:font-medium peer-checked:text-primary-foreground",
                  disabled ? "text-muted-foreground" : "hover:bg-muted/60",
                )}
              >
                {point}
              </span>
            </label>
          ))}
        </div>

        {/*
          The two ends named, under the numbers they belong to — which is what the `w-max` column
          above is for: left to the fieldset's own width, the high label would sit at the far edge
          of the form rather than under the last point.
        */}
        {(lowLabel !== "" || highLabel !== "") && (
          <div className="flex justify-between gap-4 text-xs text-muted-foreground">
            <span>{lowLabel}</span>
            <span>{highLabel}</span>
          </div>
        )}
      </div>
    </fieldset>
  );
}
