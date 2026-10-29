"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, ClipboardList, MessagesSquare } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { EmptyState } from "@/components/list-states";
import { GoalMarkerBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  stickyColumn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TEMPERATURE_MAX, temperatureTone } from "@/lib/coaching";
import { groupIdOfGoal } from "@/lib/competencies";
import { programStudentHref } from "@/lib/links";
import { initials } from "@/lib/people";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

type Payload = RouterOutputs["coaching"]["overview"];
type Fellow = Payload["fellows"][number];
type Goal = Fellow["goals"][number];

/** The key of the Other Goal column, which no competency group's id can equal. */
const OTHER = "other";

/**
 * The Coaching tab of the Fellows screen: where every fellow stands since their most recent
 * completed coaching session, one row each.
 *
 * The row reads left to right as the session did: the temperature and how long ago it was taken,
 * the goal the fellow is working on in each competency group, and the start of each answer the
 * form marks for this tab, which opens in full on a click.
 *
 * **One form at a time, chosen above the table.** Sessions run through different forms ask
 * different questions, so the rows are each fellow's latest session through the chosen form, and
 * the picker offers every form a completed session of this program was run through. The choice
 * lives in the query string, as the cohort does, so a link carries it.
 *
 * **The answer columns come from the form.** Each question an admin marks for this tab carries a
 * short column heading, because a prompt is a full question and too long to head a column; the
 * cell's popover shows the question as it was asked. The columns are the union of the marked
 * questions across the rows' sessions, in the order first met down the roster — one form, but a
 * form edited between two sessions can ask slightly different questions, and a fellow whose
 * session lacks a question has an empty cell under it, the rule the coaching CSV applies.
 *
 * **One goal per group.** A fellow may hold several goals in a group, and the cell shows the one
 * they last worked on — set most recently, or with the newest progress note — and says how many
 * more there are, so a cell with one goal in it is never read as the fellow having only one.
 *
 * A fellow with no completed session has empty session cells and their goals beside them, since
 * goals are the fellow's own and stand without a session. Nothing on the row is flagged.
 */
export function CoachingOverview({
  programId,
  data,
  cohortName,
}: {
  programId: string;
  data: Payload;
  /** Cohort id to name, so a row prints a name rather than searching the list for one. */
  cohortName: Map<string, string>;
}) {
  const [sort, setSort] = React.useState<Sort | null>(null);

  if (data.fellows.length === 0) {
    return (
      <EmptyState
        icon={<MessagesSquare />}
        title="Nobody to read yet"
        description="Fellows appear here once they are on the roster. Test students and removed fellows are never shown."
      />
    );
  }

  const goalColumns = [
    ...data.groups.map((group) => ({ key: group.id, title: group.name })),
    { key: OTHER, title: "Other Goal" },
  ];

  const goalsByFellow = new Map(
    data.fellows.map((fellow) => [
      fellow.enrollmentId,
      newestGoalPerColumn(fellow.goals, data.groups),
    ]),
  );

  /*
    The answer columns: every marked question any row's session asked, once, in the order first
    met reading the roster by name — by name rather than by the chosen sort, so the columns stay
    where they are while a reader sorts the rows.
  */
  const answerColumns: { id: string; heading: string }[] = [];
  for (const fellow of [...data.fellows].sort((a, b) =>
    fellowName(a).localeCompare(fellowName(b)),
  )) {
    for (const answer of fellow.session?.answers ?? []) {
      if (!answerColumns.some((column) => column.id === answer.id)) {
        answerColumns.push({ id: answer.id, heading: answer.heading });
      }
    }
  }

  /*
    A goal column sorts by the competency of the goal shown in it, so the fellows working on the
    same competency sit together whichever indicator or pitfall each chose. Fellows tied on the
    sorted figure, and every fellow before a column is chosen, are in name order.
  */
  const competencyIn = (fellow: Fellow, key: string) =>
    goalsByFellow.get(fellow.enrollmentId)!.get(key)?.goal.competencyName ?? null;

  const rows = [...data.fellows].sort((a, b) => {
    const byName = fellowName(a).localeCompare(fellowName(b));
    if (sort === null) return byName;

    let order: number;
    if (sort.key === NAME) {
      order = compare(fellowName(a), fellowName(b), sort.direction);
    } else if (sort.key === TEMPERATURE) {
      order = compare(
        a.session?.temperature ?? null,
        b.session?.temperature ?? null,
        sort.direction,
      );
    } else if (sort.key === DAYS) {
      order = compare(a.session?.daysSince ?? null, b.session?.daysSince ?? null, sort.direction);
    } else {
      order = compare(competencyIn(a, sort.key), competencyIn(b, sort.key), sort.direction);
    }
    return order || byName;
  });

  const width =
    FELLOW_REM + 2 * FIGURE_REM + goalColumns.length * GOAL_REM + answerColumns.length * ANSWER_REM;

  return (
    <div className="flex flex-col gap-2">
      <FormFilter forms={data.forms} form={data.form} />
      <p className="text-xs text-muted-foreground">
        From each fellow&apos;s most recent completed session through that form. A goal column shows
        the goal the fellow last set or posted progress on in that group. Click a goal or an answer
        to read it in full.
      </p>
      {/*
        `overflow-hidden` clips the table to this rounded border. Without it, the fellow column's
        background paints square over the corners.
      */}
      <div className="w-fit max-w-full overflow-hidden rounded-lg border border-border">
        <Table className="table-fixed" style={{ width: `${width}rem` }}>
          <colgroup>
            <col style={{ width: `${FELLOW_REM}rem` }} />
            <col style={{ width: `${FIGURE_REM}rem` }} />
            <col style={{ width: `${FIGURE_REM}rem` }} />
            {goalColumns.map((column) => (
              <col key={column.key} style={{ width: `${GOAL_REM}rem` }} />
            ))}
            {answerColumns.map((column) => (
              <col key={column.id} style={{ width: `${ANSWER_REM}rem` }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead
                aria-sort={ariaSort(sort, NAME)}
                className={cn(stickyColumn, "text-xs font-normal")}
              >
                <SortButton label="Fellow" sortKey={NAME} sort={sort} onSort={setSort} />
              </TableHead>
              <TableHead
                aria-sort={ariaSort(sort, TEMPERATURE)}
                className="border-l border-border text-xs font-normal"
              >
                <SortButton
                  label="Temperature"
                  sortKey={TEMPERATURE}
                  sort={sort}
                  onSort={setSort}
                />
              </TableHead>
              <TableHead
                aria-sort={ariaSort(sort, DAYS)}
                className="text-xs font-normal whitespace-normal"
              >
                <SortButton
                  label="Days since session"
                  sortKey={DAYS}
                  sort={sort}
                  onSort={setSort}
                />
              </TableHead>
              {goalColumns.map((column, i) => (
                <TableHead
                  key={column.key}
                  aria-sort={ariaSort(sort, column.key)}
                  className={cn(
                    "text-xs font-normal whitespace-normal",
                    i === 0 && "border-l border-border",
                  )}
                >
                  <SortButton
                    label={column.title}
                    sortKey={column.key}
                    sort={sort}
                    onSort={setSort}
                  />
                </TableHead>
              ))}
              {answerColumns.map((column, i) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    "text-xs font-normal whitespace-normal",
                    i === 0 && "border-l border-border",
                  )}
                >
                  {column.heading}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((fellow) => {
              const goalsByColumn = goalsByFellow.get(fellow.enrollmentId)!;

              return (
                <TableRow key={fellow.enrollmentId} className="align-top">
                  {/*
                    The fellow column stays put while the rest scrolls beneath it, because a row
                    without a name beside it is a row nobody can act on.
                  */}
                  <TableCell className={stickyColumn}>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                          {initials(fellow.student.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-col">
                        <Link
                          href={programStudentHref(programId, fellow.student.id, "coaching")}
                          className="truncate font-medium hover:underline"
                        >
                          {fellowName(fellow)}
                        </Link>
                        <span className="truncate text-xs text-muted-foreground">
                          {fellow.cohortId === null
                            ? "No cohort"
                            : (cohortName.get(fellow.cohortId) ?? "Unknown cohort")}
                        </span>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="border-l border-border text-center align-middle">
                    {/*
                      The number alone, coloured by band, and nothing when it was never asked: an
                      empty square would read as a score of nothing.
                    */}
                    {fellow.session !== null && fellow.session.temperature !== null && (
                      <span
                        aria-label={`Temperature ${fellow.session.temperature} of ${TEMPERATURE_MAX}`}
                        className={cn(
                          "inline-flex size-6 items-center justify-center rounded-md border text-xs font-medium tabular-nums",
                          TONE_CLASSES[temperatureTone(fellow.session.temperature)],
                        )}
                      >
                        {fellow.session.temperature}
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="align-middle text-sm tabular-nums">
                    {fellow.session !== null && daysLabel(fellow.session.daysSince)}
                  </TableCell>

                  {goalColumns.map((column, i) => (
                    <TableCell
                      key={column.key}
                      className={cn("whitespace-normal", i === 0 && "border-l border-border")}
                    >
                      <GoalCell column={goalsByColumn.get(column.key)} />
                    </TableCell>
                  ))}

                  {answerColumns.map((column, i) => {
                    const answer = fellow.session?.answers.find(
                      (candidate) => candidate.id === column.id,
                    );
                    return (
                      <TableCell
                        key={column.id}
                        className={cn("whitespace-normal", i === 0 && "border-l border-border")}
                      >
                        {answer !== undefined && answer.answer.trim() !== "" && (
                          <AnswerCell prompt={answer.prompt} answer={answer.answer} />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * Which form the rows are read from. The choice is written to `?form=`, the way the cohort
 * picker writes `?cohort=`, so the page reads it on the server and a link carries it. Nothing to
 * choose between while every session used one form, so the picker is then a label.
 */
function FormFilter({
  forms,
  form,
}: {
  forms: { id: string; name: string }[];
  form: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (forms.length === 0 || form === null) return null;

  const choose = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("form", next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <ClipboardList aria-hidden className="size-3.5" />
      <span>Form</span>
      {forms.length === 1 ? (
        <span className="text-foreground">{forms[0]!.name}</span>
      ) : (
        <Select
          value={form}
          items={Object.fromEntries(forms.map((candidate) => [candidate.id, candidate.name]))}
          onValueChange={(next) => next && choose(next)}
        >
          <SelectTrigger className="h-8 w-56" aria-label="Coaching form">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {forms.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/** The width of the fellow column, the two session figures, a goal, and an answer. */
const FELLOW_REM = 13;
const FIGURE_REM = 6.5;
const GOAL_REM = 14;
const ANSWER_REM = 12;

/**
 * The sort keys of the fellow, temperature, and days-since-session columns. A goal column's key is
 * its group's id or `OTHER`.
 */
const NAME = "name";
const TEMPERATURE = "temperature";
const DAYS = "days";

/** A column key and which way. */
type Sort = { key: string; direction: "asc" | "desc" };

/**
 * Empty cells last in either direction, since a reader sorting a column is reading its figures.
 * Temperatures and days compare as numbers, and names and competency names alphabetically.
 */
function compare(
  a: number | string | null,
  b: number | string | null,
  direction: Sort["direction"],
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const order = typeof a === "string" ? a.localeCompare(b as string) : a - (b as number);
  return direction === "asc" ? order : -order;
}

function ariaSort(sort: Sort | null, key: string): "ascending" | "descending" | undefined {
  if (sort?.key !== key) return undefined;
  return sort.direction === "asc" ? "ascending" : "descending";
}

/** The first press sorts ascending, the next descending, and a third returns to name order. */
function SortButton({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: string;
  sort: Sort | null;
  onSort: (sort: Sort | null) => void;
}) {
  const active = sort?.key === sortKey;
  const next: Sort | null = !active
    ? { key: sortKey, direction: "asc" }
    : sort.direction === "asc"
      ? { key: sortKey, direction: "desc" }
      : null;

  return (
    <button
      type="button"
      onClick={() => onSort(next)}
      aria-label={`Sort by ${label.toLowerCase()}`}
      className={cn(
        "flex items-end gap-1 rounded-sm text-left transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span>{label}</span>
      {!active ? (
        <ChevronsUpDown className="mb-0.5 size-3 shrink-0" aria-hidden />
      ) : sort.direction === "asc" ? (
        <ArrowUp className="mb-0.5 size-3 shrink-0" aria-hidden />
      ) : (
        <ArrowDown className="mb-0.5 size-3 shrink-0" aria-hidden />
      )}
    </button>
  );
}

function daysLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

/**
 * For each column, the goal the fellow last worked on in it and how many others it hides. A column
 * with no goal has no entry, which the cell draws as empty.
 */
function newestGoalPerColumn(
  goals: readonly Goal[],
  groups: Payload["groups"],
): Map<string, { goal: Goal; more: number }> {
  const byColumn = new Map<string, { goal: Goal; more: number }>();

  for (const goal of goals) {
    const key = groupIdOfGoal(goal, groups) ?? OTHER;
    const held = byColumn.get(key);

    if (held === undefined) {
      byColumn.set(key, { goal, more: 0 });
    } else if (goal.activeAt > held.goal.activeAt) {
      byColumn.set(key, { goal, more: held.more + 1 });
    } else {
      held.more += 1;
    }
  }

  return byColumn;
}

/**
 * One goal in two lines, the height of the fellow cell beside it: the title and how many more goals
 * the fellow holds in this column, then the competency and where the fellow places themselves.
 *
 * **Each line is cut to the column's width rather than wrapped**, so every row is the same height
 * and more of the roster fits on one screen. Clicking the cell opens the whole goal, the way a
 * check-in answer opens: the title, the indicator or pitfall it was built on, and the three parts
 * of the plan, under the labels the fellow wrote them beneath.
 */
function GoalCell({ column }: { column: { goal: Goal; more: number } | undefined }) {
  if (column === undefined) return null;
  const { goal, more } = column;
  const hasPlan = goal.successCriteria !== "" || goal.objectives !== "" || goal.actionPlan !== "";

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex w-full min-w-0 flex-col gap-1 rounded-sm text-left transition-colors hover:text-foreground/80"
          >
            <span className="flex w-full min-w-0 items-baseline gap-1.5">
              <span className="truncate text-sm font-medium">{goal.title}</span>
              {more > 0 && (
                <span className="shrink-0 text-xs text-muted-foreground">+{more} more</span>
              )}
            </span>
            <span className="flex w-full min-w-0 items-center gap-1.5">
              {goal.competencyName !== null && (
                <span className="truncate text-xs text-muted-foreground">
                  {goal.competencyName}
                </span>
              )}
              <GoalMarkerBadge marker={goal.marker} className="shrink-0 px-1.5 py-0 text-[11px]" />
            </span>
          </button>
        }
      />
      <PopoverContent
        align="start"
        className="flex max-h-[60vh] w-[min(26rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto"
      >
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{goal.title}</span>
          {goal.entryText !== null && (
            <span className="text-xs text-muted-foreground">
              <span className="font-medium">{goal.competencyName}</span> “{goal.entryText}”
              {goal.entryKind === "PITFALL" && " · working away from a pitfall"}
            </span>
          )}
          <GoalMarkerBadge marker={goal.marker} className="self-start" />
        </div>
        {goal.successCriteria !== "" && (
          <GoalPart label="What success looks like" text={goal.successCriteria} />
        )}
        {goal.objectives !== "" && (
          <GoalPart label="Skills, Habits, & Mindsets" text={goal.objectives} />
        )}
        {goal.actionPlan !== "" && <GoalPart label="Action plan" text={goal.actionPlan} />}
        {!hasPlan && <p className="text-sm text-muted-foreground">No plan written yet.</p>}
      </PopoverContent>
    </Popover>
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

/** The start of one answer, which opens to the whole answer and the question as it was asked. */
function AnswerCell({ prompt, answer }: { prompt: string; answer: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="line-clamp-2 rounded-sm text-left text-xs text-foreground/80 transition-colors hover:text-foreground"
          >
            {answer}
          </button>
        }
      />
      <PopoverContent
        align="start"
        className="flex max-h-[60vh] w-[min(26rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto"
      >
        <span className="text-xs font-medium text-muted-foreground">{prompt}</span>
        <p className="text-sm whitespace-pre-wrap">{answer}</p>
      </PopoverContent>
    </Popover>
  );
}

function fellowName(fellow: Fellow): string {
  const { student } = fellow;
  return student.displayName ?? student.githubUsername ?? student.email ?? "Unnamed";
}
