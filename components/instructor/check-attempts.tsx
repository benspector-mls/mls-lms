"use client";

import { useMutation } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsUpDown,
  HandHelping,
  Loader2,
  RotateCw,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { CheckSummary } from "@/components/instructor/check-summary";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { CheckLevelBadge, CheckLevelDots } from "@/components/status-badge";
import { TestStudentBadge } from "@/components/test-student-badge";
import { CohortPicker } from "@/components/instructor/cohort-picker";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { describeRetryWait, latestAttempt, MAX_ATTEMPTS } from "@/lib/checks/attempts";
import {
  type AttemptsSort,
  type AttemptsSortColumn,
  DEFAULT_ATTEMPTS_SORT,
  firstAttempt,
  sortAttemptRows,
  toggleAttemptsSort,
  understandingTally,
} from "@/lib/checks/table";
import {
  CATEGORY_LABEL,
  CHECK_LEVELS,
  type CheckCategory,
  effectiveLevel,
  LEVEL_NAME,
  levelCategory,
} from "@/lib/checks/levels";
import type { CheckLevel } from "@/lib/generated/prisma/enums";
import { curriculumHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import {
  type CohortChoice,
  cohortSelectionLabel,
  inCohortSelection,
  parseCohortSelection,
} from "@/lib/programs/cohorts";
import { formatDateTime, formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Data = RouterOutputs["checks"]["attemptsFor"];
type Row = Data["rows"][number];
type Attempt = Row["attempts"][number];

/**
 * One check for understanding, and where the room stands on it.
 *
 * **Two overviews: current and first.** Current reads each fellow's latest attempt and answers
 * "where is the room now"; first reads each fellow's first attempt and answers "how did the lesson
 * land". The gap between them is what going back to the material did. Every response is one click
 * away on each row. The table lists every active fellow,
 * including the ones who have not answered — "who has not answered yet" is the question the list
 * exists to answer as much as "who is blocked". The cohort picker narrows the counts and the
 * table in the browser, as the roster does, and the line above the counts says what they were
 * narrowed to; the summary beneath the counts reads every fellow whichever cohort is shown.
 *
 * An instructor may set a level over the review's on any attempt, run the review again on one, and
 * ask for a summary of what every answer has in common. None of these is a grade: a check has no
 * score, and nothing here reaches the gradebook.
 */
export function CheckAttempts({
  data,
  courseId,
  choice,
  now,
}: {
  data: Data;
  courseId: string;
  /** The cohort picker's options and the selection this screen was built for. */
  choice: CohortChoice;
  now: Date;
}) {
  const { check } = data;
  const [sort, setSort] = React.useState<AttemptsSort>(DEFAULT_ATTEMPTS_SORT);

  const selection = parseCohortSelection(choice.cohort);
  const shown = React.useMemo(
    () => data.rows.filter((row) => inCohortSelection(selection, row.cohortId)),
    [data.rows, selection],
  );
  const rows = React.useMemo(
    () => sortAttemptRows(shown, sort, (row) => displayNameOf(row.student, "Fellow")),
    [shown, sort],
  );
  const tally = React.useMemo(() => understandingTally(shown), [shown]);

  return (
    <>
      <PageHeader
        eyebrow="Check for understanding"
        title={check.resourceTitle}
        description={check.objective}
        actions={
          <>
            <CohortPicker choice={choice} />
            <Link
              href={curriculumHref(courseId)}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Curriculum
            </Link>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3">
          <Markdown content={check.question} />
          <p className="text-xs text-muted-foreground">
            Up to {MAX_ATTEMPTS} attempts, {describeRetryWait(check.retryWaitHours)} apart.
          </p>
          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ChevronRight
                aria-hidden="true"
                className="size-4 transition-transform group-data-[panel-open]:rotate-90"
              />
              The two examples
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Level 2 · {CATEGORY_LABEL[2]}
                  </p>
                  <Markdown content={check.factsExample} />
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Level 3 · {CATEGORY_LABEL[3]}
                  </p>
                  <Markdown content={check.exemplar} />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/*
        Current first, because it is where the room stands; first beneath it, because the gap
        between the two is what going back to the material did. Each fellow counts once in each row.
      */}
      <div className="flex flex-col gap-3">
        {selection.kind !== "all" && (
          <p className="text-xs text-muted-foreground">
            Showing{" "}
            <span className="font-medium text-foreground">
              {cohortSelectionLabel(selection, choice.cohorts)}
            </span>
            : {shown.length} {shown.length === 1 ? "fellow" : "fellows"}.
          </p>
        )}
        <Overview
          title="Current understanding"
          hint="Each fellow's latest attempt."
          counts={tally.current}
        />
        <Overview
          title="First understanding"
          hint="Each fellow's first attempt."
          counts={tally.first}
        />
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <HandHelping aria-hidden="true" className="size-3.5" />
            <span className="font-medium text-foreground tabular-nums">{tally.askedForHelp}</span>
            asked for help
          </span>
          <span>
            <span className="font-medium text-foreground tabular-nums">{tally.notYetAnswered}</span>{" "}
            not yet answered
          </span>
        </p>
      </div>

      <CheckSummary
        checkId={check.id}
        summary={check.summary}
        summaryAt={check.summaryAt}
        rows={data.rows}
        now={now}
      />

      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="Fellow" by="name" sort={sort} onSort={setSort} />
            <SortableHead label="First attempt" by="first" sort={sort} onSort={setSort} />
            <SortableHead label="Current" by="current" sort={sort} onSort={setSort} />
            <SortableHead label="Attempts" by="attempts" sort={sort} onSort={setSort} />
            <SortableHead
              label="Submitted"
              by="submitted"
              sort={sort}
              onSort={setSort}
              className="text-right"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <FellowRow key={row.student.id} row={row} now={now} />
          ))}
        </TableBody>
      </Table>

      <Legend />
    </>
  );
}

/**
 * One row of the overview: how many fellows sit in each category, on one line per category so the
 * three read across at a glance without a card each the height of a headline number.
 */
function Overview({
  title,
  hint,
  counts,
}: {
  title: string;
  hint: string;
  counts: Record<CheckCategory, number>;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex shrink-0 flex-col sm:w-44">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-2">
        {([1, 2, 3] as const).map((category) => (
          <div
            key={category}
            className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
          >
            <CheckLevelDots category={category} />
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {CATEGORY_LABEL[category]}
            </span>
            <span className="ml-auto text-sm font-semibold tabular-nums">{counts[category]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A header that sorts the table, with the arrow showing which way when it is the active one. */
function SortableHead({
  label,
  by,
  sort,
  onSort,
  className,
}: {
  label: string;
  by: AttemptsSortColumn;
  sort: AttemptsSort;
  onSort: (sort: AttemptsSort) => void;
  className?: string;
}) {
  const active = sort.by === by;

  return (
    <TableHead
      className={className}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(toggleAttemptsSort(sort, by))}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {!active ? (
          <ChevronsUpDown className="size-3 shrink-0" aria-hidden />
        ) : sort.direction === "asc" ? (
          <ArrowUp className="size-3 shrink-0" aria-hidden />
        ) : (
          <ArrowDown className="size-3 shrink-0" aria-hidden />
        )}
      </button>
    </TableHead>
  );
}

/** One attempt's mark in a cell: the dots, or why there are none, and a hand if it asked for help. */
function AttemptMark({ attempt }: { attempt: Attempt | null }) {
  if (!attempt) return <span className="text-muted-foreground">—</span>;
  const level = effectiveLevel(attempt);

  return (
    <span className="flex items-center gap-1.5">
      {level ? (
        <CheckLevelBadge level={level} dotsOnly />
      ) : attempt.reviewError ? (
        <ReviewDidNotRun error={attempt.reviewError} />
      ) : null}
      {attempt.wantsHelp && <WantsHelp />}
    </span>
  );
}

/**
 * One fellow: their first and latest attempts at a glance, and every response beneath when the row
 * is opened.
 *
 * **The whole row opens**, not a link in one cell, so there is no column spent on a clipped preview
 * of an answer. The toggle is a button in the first cell for the keyboard and for a screen reader,
 * which is told whether the row is open; a click anywhere else on the row does the same thing.
 *
 * The responses are a second table row spanning every column rather than a nested table, so a long
 * answer reads at the page's full width.
 */
function FellowRow({ row, now }: { row: Row; now: Date }) {
  const [open, setOpen] = React.useState(false);
  const first = firstAttempt(row.attempts);
  const latest = latestAttempt(row.attempts);
  const name = displayNameOf(row.student, "Fellow");
  const answered = row.attempts.length > 0;
  const toggle = () => answered && setOpen((current) => !current);

  return (
    <>
      <TableRow onClick={toggle} className={cn(answered && "cursor-pointer", open && "border-b-0")}>
        <TableCell>
          <span className="flex items-center gap-2 font-medium">
            {answered ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  toggle();
                }}
                aria-expanded={open}
                aria-label={`${open ? "Hide" : "Show"} ${name}'s responses`}
                className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={cn("size-4 transition-transform", open && "rotate-90")}
                />
              </button>
            ) : (
              <span aria-hidden="true" className="size-5" />
            )}
            {name}
            {row.student.testStudentNumber !== null && <TestStudentBadge />}
          </span>
        </TableCell>
        <TableCell>
          <AttemptMark attempt={first} />
        </TableCell>
        <TableCell>
          <AttemptMark attempt={latest} />
        </TableCell>
        <TableCell className="tabular-nums">
          {answered ? (
            `${row.attempts.length} of ${MAX_ATTEMPTS}`
          ) : (
            <span className="text-muted-foreground">Not yet answered</span>
          )}
        </TableCell>
        <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
          {latest ? (
            <span title={formatDateTime(latest.submittedAt)}>
              {formatRelative(latest.submittedAt, now)}
            </span>
          ) : null}
        </TableCell>
      </TableRow>

      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="bg-muted/20 whitespace-normal">
            <div className="flex flex-col gap-3 py-2">
              {row.attempts.map((attempt) => (
                <AttemptDetail key={attempt.id} attempt={attempt} />
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** One attempt in full, with the controls an instructor has over it. */
function AttemptDetail({ attempt }: { attempt: Attempt }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const level = effectiveLevel(attempt);

  const setLevel = useMutation(
    trpc.checks.setLevel.mutationOptions(
      settled({ onSuccess: () => toast.success("Level saved.") }),
    ),
  );
  const reviewAgain = useMutation(
    trpc.checks.reviewAgain.mutationOptions(
      settled({
        onSuccess: (row) =>
          row.reviewError
            ? toast.error("The review did not run again. The reason is on the attempt.")
            : toast.success("Reviewed."),
      }),
    ),
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          Attempt {attempt.attempt} of {MAX_ATTEMPTS}
        </span>
        <span className="text-xs text-muted-foreground">{formatDateTime(attempt.submittedAt)}</span>
        {level && <CheckLevelBadge level={level} dotsOnly />}
        {attempt.instructorLevel && attempt.level && (
          <span className="text-xs text-muted-foreground">
            set by an instructor; the review said {LEVEL_NAME[attempt.level].toLowerCase()}
          </span>
        )}
        {attempt.wantsHelp && <WantsHelp />}
      </div>

      <div className="text-sm">
        <Markdown content={attempt.answer} />
      </div>

      {attempt.explanation && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Feedback: </span>
          {attempt.explanation}
        </p>
      )}
      {attempt.reviewError && (
        <p className="text-sm text-destructive">The review did not run: {attempt.reviewError}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Select
          value={attempt.instructorLevel ?? "none"}
          onValueChange={(next) => {
            if (!next) return;
            setLevel.mutate({
              attemptId: attempt.id,
              level: next === "none" ? null : (next as CheckLevel),
            });
          }}
          items={{
            none: "The review's level",
            ...Object.fromEntries(CHECK_LEVELS.map((value) => [value, levelOption(value)])),
          }}
        >
          <SelectTrigger size="sm" aria-label="Set this attempt's level" className="min-w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/*
              A sentinel rather than an empty value, because the select is keyed by string and
              "no instructor level" has to be something an instructor can choose.
            */}
            <SelectItem value="none">The review&apos;s level</SelectItem>
            {CHECK_LEVELS.map((value) => (
              <SelectItem key={value} value={value}>
                {levelOption(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {setLevel.isPending && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
        )}

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={reviewAgain.isPending}
          onClick={() => reviewAgain.mutate({ attemptId: attempt.id })}
        >
          {reviewAgain.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <RotateCw data-icon="inline-start" />
          )}
          {reviewAgain.isPending ? "Reviewing…" : "Review again"}
        </Button>
      </div>

      {(setLevel.error || reviewAgain.error) && (
        <p className="text-sm text-destructive" role="alert">
          {(setLevel.error ?? reviewAgain.error)?.message}
        </p>
      )}
    </div>
  );
}

/** "Understands facts · Multistructural": the category a fellow reads, and the SOLO name. */
function levelOption(level: CheckLevel): string {
  return `${CATEGORY_LABEL[levelCategory(level)]} · ${LEVEL_NAME[level]}`;
}

/** The fellow asked to go over this with an instructor: a hand, explained on hover and in the legend. */
function WantsHelp() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex cursor-help items-center rounded-full border border-border px-1.5 py-0.5 text-muted-foreground" />
        }
      >
        <HandHelping aria-hidden="true" className="size-3.5" />
        <span className="sr-only">Asked to go over this with an instructor</span>
      </TooltipTrigger>
      <TooltipContent>Asked to go over this with an instructor</TooltipContent>
    </Tooltip>
  );
}

/**
 * What the table's marks mean, beneath it. The dots carry no words in the table itself, so that a
 * column of levels reads at a glance; this is where the words are, once.
 */
function Legend() {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
      {([1, 2, 3] as const).map((category) => (
        <div key={category} className="flex items-center gap-2">
          <dt>
            <CheckLevelDots category={category} />
            <span className="sr-only">Level {category} of 3</span>
          </dt>
          <dd>{CATEGORY_LABEL[category]}</dd>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <dt>
          <HandHelping aria-hidden="true" className="size-3.5" />
          <span className="sr-only">Hand</span>
        </dt>
        <dd>Asked to go over this with an instructor</dd>
      </div>
    </dl>
  );
}

/** The review failed; the reason is written for an instructor, so it is on hover here. */
function ReviewDidNotRun({ error }: { error: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex cursor-help items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground" />
        }
      >
        Review did not run
      </TooltipTrigger>
      <TooltipContent>{error}</TooltipContent>
    </Tooltip>
  );
}
