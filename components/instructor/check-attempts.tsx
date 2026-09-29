"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronRight, HandHelping, Loader2, RotateCw } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { CheckLevelBadge, CheckLevelDots } from "@/components/status-badge";
import { TestStudentBadge } from "@/components/test-student-badge";
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
import { DEFAULT_ROSTER_SORT, sortRoster } from "@/lib/roster";
import { formatDateTime, formatRelative } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Data = RouterOutputs["checks"]["attemptsFor"];
type Row = Data["rows"][number];
type Attempt = Row["attempts"][number];

/**
 * One check for understanding, and where the room stands on it.
 *
 * **The tiles read each fellow's latest attempt**, because they answer "where is the classroom
 * now"; the whole history is one click away on each row. The table lists every active fellow,
 * including the ones who have not answered — "who has not answered yet" is the question the list
 * exists to answer as much as "who is blocked".
 *
 * An instructor may set a level over the review's on any attempt, and run the review again on one.
 * Neither is a grade: a check has no score, and nothing here reaches the gradebook.
 */
export function CheckAttempts({
  data,
  courseId,
  now,
}: {
  data: Data;
  courseId: string;
  now: Date;
}) {
  const { check } = data;

  const rows = React.useMemo(
    () =>
      sortRoster(data.rows, DEFAULT_ROSTER_SORT, (row, by) =>
        by === "name" ? displayNameOf(row.student, "Fellow") : null,
      ),
    [data.rows],
  );

  const tally = React.useMemo(() => {
    const byCategory: Record<CheckCategory, number> = { 1: 0, 2: 0, 3: 0 };
    let wantsHelp = 0;
    let unanswered = 0;
    for (const row of data.rows) {
      const latest = latestAttempt(row.attempts);
      if (!latest) {
        unanswered += 1;
        continue;
      }
      const level = effectiveLevel(latest);
      if (level) byCategory[levelCategory(level)] += 1;
      if (latest.wantsHelp) wantsHelp += 1;
    }
    return { byCategory, wantsHelp, unanswered };
  }, [data.rows]);

  return (
    <>
      <PageHeader
        eyebrow="Check for understanding"
        title={check.resourceTitle}
        description={check.objective}
        actions={
          <Link
            href={curriculumHref(courseId)}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Curriculum
          </Link>
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label={CATEGORY_LABEL[1]} count={tally.byCategory[1]} />
        <Tile label={CATEGORY_LABEL[2]} count={tally.byCategory[2]} />
        <Tile label={CATEGORY_LABEL[3]} count={tally.byCategory[3]} />
        <Tile label="Asked for help" count={tally.wantsHelp} />
        <Tile label="Not yet answered" count={tally.unanswered} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fellow</TableHead>
            <TableHead>Latest level</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Latest answer</TableHead>
            <TableHead className="text-right">Submitted</TableHead>
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

function Tile({ label, count }: { label: string; count: number }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-0.5">
        <span className="text-2xl font-semibold tabular-nums">{count}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

/**
 * One fellow: their latest attempt at a glance, and every attempt beneath it when opened.
 *
 * The history is a second table row spanning every column rather than a nested table, so a long
 * answer reads at the page's full width instead of inside one cell.
 */
function FellowRow({ row, now }: { row: Row; now: Date }) {
  const [open, setOpen] = React.useState(false);
  const latest = latestAttempt(row.attempts);
  const level = latest ? effectiveLevel(latest) : null;
  const name = displayNameOf(row.student, "Fellow");

  return (
    <>
      <TableRow>
        <TableCell>
          <span className="flex items-center gap-2 font-medium">
            {name}
            {row.student.testStudentNumber !== null && <TestStudentBadge />}
          </span>
        </TableCell>
        <TableCell>
          {!latest ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="flex items-center gap-1.5">
              {level ? (
                <CheckLevelBadge level={level} dotsOnly />
              ) : latest.reviewError ? (
                <ReviewDidNotRun error={latest.reviewError} />
              ) : null}
              {latest.wantsHelp && <WantsHelp />}
            </span>
          )}
        </TableCell>
        <TableCell className="tabular-nums">
          {row.attempts.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            `${row.attempts.length} of ${MAX_ATTEMPTS}`
          )}
        </TableCell>
        <TableCell className="max-w-72">
          {latest ? (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              className="group flex w-full items-start gap-1.5 text-left"
            >
              <ChevronRight
                aria-hidden="true"
                className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
              />
              <span className="line-clamp-2 text-sm whitespace-normal group-hover:underline">
                {latest.answer}
              </span>
            </button>
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

      {open && latest && (
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

      {attempt.explanation && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Review: </span>
          {attempt.explanation}
        </p>
      )}
      {attempt.reviewError && (
        <p className="text-sm text-destructive">The review did not run: {attempt.reviewError}</p>
      )}

      <div className="text-sm">
        <Markdown content={attempt.answer} />
      </div>

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
