import Link from "next/link";
import {
  AlarmClock,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  MessageSquare,
  PenLine,
  Sparkles,
} from "lucide-react";

import { EmptyState } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { AssignmentKindBadge } from "@/components/status-badge";
import {
  completionMeta,
  formatDueDate,
  formatPercent,
  formatRelative,
  scorePercent,
} from "@/lib/status";
import { dashboardIsEmpty, dashboardSections } from "@/lib/student/dashboard";
import { cn } from "@/lib/utils";

import type { DashboardAssignment } from "./types";

/**
 * What a student should look at, across every course they are in.
 *
 * **The answer to the question a student actually arrives with**, which no other screen in this
 * application could give: what is due, and what have I not done. That question spans cohorts, and
 * a course page can only answer it one cohort at a time.
 *
 * A server component with no `"use client"`. Every row is a link, and `dashboardSections` is a
 * pure function, so the whole screen costs no client JavaScript.
 *
 * Every list is derived from real submission state and nothing is dismissible. Handing the work in
 * is what clears a deadline, and reading the feedback is what clears a report — see the comment at
 * the top of `lib/student/dashboard.ts` for why a dismiss button would be the one mistake this
 * screen must not make.
 */
export function StudentDashboard({
  assignments,
  now,
}: {
  assignments: DashboardAssignment[];
  /** Passed in rather than read here, so the server and the browser agree. */
  now: Date;
}) {
  const sections = dashboardSections(assignments, now);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Your Work"
        description="Everything waiting on you, across all of your courses."
      />

      {dashboardIsEmpty(sections) ? (
        /*
          One empty state rather than four, which is what makes a quiet week read as calm instead
          of as four things having failed to load. It is also the honest message: nothing waiting
          is a real and good state, not an absence of data.
        */
        <EmptyState
          icon={<Sparkles />}
          title="Nothing waiting on you"
          description={
            assignments.length === 0
              ? "When your instructor hands out work, it will appear here."
              : "You are up to date. Everything handed out has been handed in and read."
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {/*
            Overdue above upcoming, unlike the rest of this file's top-to-bottom ordering by
            recency. A missed deadline is the most useful thing on the screen and burying it under
            a week of upcoming work is how it stays missed.
          */}
          {sections.overdue.length > 0 && (
            <Section
              icon={<AlarmClock className="size-4" />}
              title="Overdue"
              count={sections.overdue.length}
              tone="danger"
            >
              {sections.overdue.map((row) => (
                <DeadlineRow key={row.id} row={row} now={now} overdue />
              ))}
            </Section>
          )}

          {sections.upcoming.length > 0 && (
            <Section
              icon={<CalendarClock className="size-4" />}
              title="Coming up"
              count={sections.upcoming.length}
            >
              {sections.upcoming.map((row) => (
                <DeadlineRow key={row.id} row={row} now={now} />
              ))}
            </Section>
          )}

          {sections.unreadFeedback.length > 0 && (
            <Section
              icon={<MessageSquare className="size-4" />}
              title="Feedback to read"
              count={sections.unreadFeedback.length}
            >
              {sections.unreadFeedback.map((row) => (
                <FeedbackRow key={row.id} row={row} now={now} />
              ))}
            </Section>
          )}

          {/*
            Last and quieter than the rest. Work a student has taken up is work they already know
            about, so this is a reminder rather than news — its deadline has said what it needs to
            say further up the page.
          */}
          {sections.inProgress.length > 0 && (
            <Section
              icon={<PenLine className="size-4" />}
              title="Started, not handed in"
              count={sections.inProgress.length}
              quiet
            >
              {sections.inProgress.map((row) => (
                <InProgressRow key={row.id} row={row} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  tone,
  quiet,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  tone?: "danger";
  /** Smaller type and less weight, for a section that is a reminder rather than news. */
  quiet?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2
        className={cn(
          "flex items-center gap-2 font-semibold",
          quiet ? "text-xs text-muted-foreground" : "text-sm",
          tone === "danger" && "text-destructive",
        )}
      >
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
        {title}
        <span className="font-normal text-muted-foreground">{count}</span>
      </h2>

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {children}
      </ul>
    </section>
  );
}

/**
 * Every row links to the assignment panel on its own course page.
 *
 * A search parameter rather than a route, because the panel is where a student's assignment lives
 * and it has no page of its own. That address is the reason the panel reads which assignment is
 * open out of the URL.
 */
function RowLink({
  row,
  children,
  className,
}: {
  row: DashboardAssignment;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <li>
      <Link
        href={`/courses/${row.course.id}?assignment=${row.id}`}
        className={cn(
          "flex items-center gap-x-3 px-3 py-2.5 transition-colors hover:bg-accent/50",
          className,
        )}
      >
        {children}
      </Link>
    </li>
  );
}

/**
 * The title and which course it is in, which is the pairing that makes a cross-course list
 * readable. A student holding four cohorts' assignments in one list needs the cohort to tell two
 * similarly named assignments apart.
 */
function RowTitle({ row }: { row: DashboardAssignment }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{row.title}</span>
        <AssignmentKindBadge kind={row.kind} className="hidden sm:inline-flex" />
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {row.course.name} · {row.module.name}
      </span>
    </span>
  );
}

function DeadlineRow({
  row,
  now,
  overdue,
}: {
  row: DashboardAssignment;
  now: Date;
  overdue?: boolean;
}) {
  return (
    <RowLink row={row}>
      <RowTitle row={row} />

      {/*
        The date and how far off it is, both. "Thursday, Oct 9 at 11:59 PM" is what a student puts
        in a calendar, and "in 2 days" is what tells them whether to worry — neither alone does
        both jobs, and the pair is what makes the list scannable.
      */}
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <span
          className={cn(
            "text-xs whitespace-nowrap",
            overdue ? "font-medium text-destructive" : "text-foreground",
          )}
        >
          {formatDueDate(row.dueAt)}
        </span>
        <span
          className={cn(
            "text-xs whitespace-nowrap",
            overdue ? "text-destructive/80" : "text-muted-foreground",
          )}
        >
          {overdue ? `due ${formatRelative(row.dueAt, now)}` : formatRelative(row.dueAt, now)}
        </span>
      </span>
    </RowLink>
  );
}

function FeedbackRow({ row, now }: { row: DashboardAssignment; now: Date }) {
  const submission = row.submission;
  const verdict = completionMeta(submission?.isComplete);
  const percent = scorePercent(submission?.finalScore, submission?.finalScorePossible);

  return (
    <RowLink row={row}>
      <RowTitle row={row} />

      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        {/*
          The score carries the verdict, as it does everywhere else: the pill on the course page
          says "Graded" in blue, and green means the completion threshold was met and nothing more.
          Colour is not the only signal — the icon gives it a shape and the word is read out.
        */}
        <span
          className={cn(
            "flex items-center gap-1 text-sm whitespace-nowrap tabular-nums",
            verdict?.className,
          )}
        >
          {verdict &&
            (submission?.isComplete ? (
              <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
              <CircleSlash aria-hidden="true" className="size-3.5 shrink-0" />
            ))}
          {verdict && <span className="sr-only">{verdict.label}. </span>}
          <span className="font-medium">
            {submission?.finalScore}/{submission?.finalScorePossible}
          </span>
          <span className={verdict ? undefined : "text-muted-foreground"}>
            {formatPercent(percent)}
          </span>
        </span>

        <span className="text-xs whitespace-nowrap text-muted-foreground">
          returned {formatRelative(submission?.gradedAt, now)}
        </span>
      </span>
    </RowLink>
  );
}

function InProgressRow({ row }: { row: DashboardAssignment }) {
  return (
    <RowLink row={row} className="py-2">
      <RowTitle row={row} />
      <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
        {row.dueAt ? `Due ${formatDueDate(row.dueAt)}` : "No due date"}
      </span>
    </RowLink>
  );
}
