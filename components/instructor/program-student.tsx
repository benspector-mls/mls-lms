import Link from "next/link";
import { Archive, ArrowRight, CircleCheck, EyeOff, GitBranch, UserMinus } from "lucide-react";

import { ArrivalAveragesPanel } from "@/components/arrival-averages";
import { TestStudentBadge } from "@/components/test-student-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { studentHref } from "@/lib/links";
import { displayNameOf, initials } from "@/lib/people";
import { formatSchoolDay } from "@/lib/school-time";
import { formatPercent } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * One fellow, across the whole matriculation.
 *
 * **About the person rather than about their work**, which is what makes it a different screen from
 * the per-course record reached from the gradebook. That one is their submissions in one course,
 * opened to grade them; this is who they are, how the mornings have gone, when they arrive, which
 * cohort they are in, where they stand in each course of the year, and their GCF history.
 *
 * Splitting the two is what lets grading stay per course while the roster lives above every course.
 * It is what the roster's rows point at, and every course row here is a way into the other screen.
 *
 * **Their GCF results name no matriculation.** A result is sat at CodeSignal on a fellow's own
 * schedule and carries no program, so somebody repeating a year has one history rather than two
 * halves of it — the same reason `/gcf` is addressed outside every scope.
 *
 * A server component: every figure is computed on the server and nothing here is interactive.
 */

type Data = RouterOutputs["programs"]["student"];

export function ProgramStudent({ data }: { data: Data }) {
  const name = displayNameOf(data.student, "Unnamed");
  const removed = data.enrollmentStatus !== "ACTIVE";

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-4">
        <Avatar className="size-12">
          <AvatarFallback className="bg-primary/10 font-medium text-primary">
            {initials(data.student.displayName ?? data.student.email)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{name}</h2>
            {data.student.testStudentNumber !== null && <TestStudentBadge />}
            {/*
              Said here rather than only implied by a lower rate. Removal is a status rather than a
              deleted row, so this page still renders in full — and a reader acting on it needs to
              know they are reading somebody who has left.
            */}
            {removed && (
              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                <UserMinus className="size-3" />
                No longer enrolled
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{data.student.email ?? "—"}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {data.student.githubUsername ? (
              <span className="inline-flex items-center gap-1.5">
                <GitBranch className="size-3.5" />
                {data.student.githubUsername}
              </span>
            ) : (
              /*
                Worth naming rather than leaving blank. Every repository this fellow accepts is named
                after their GitHub login, so without one nothing can be handed to them — and this is
                the screen somebody opens when a fellow says they cannot accept an assignment.
              */
              <span className="text-amber-600 dark:text-amber-500">
                No GitHub account linked yet
              </span>
            )}
            <span>joined {formatSchoolDay(data.enrolledFrom)}</span>
            {/*
              Which cohort, in words either way. A blank would read as missing data where "no cohort"
              is a fact — and one nobody has acted on is exactly what somebody comes here to find.
            */}
            <span>
              {data.cohort ? data.cohort.name : "In no cohort"}
            </span>
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Attendance</h2>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm">
            {data.summary.rate === null ? (
              <>Nothing has been counted yet.</>
            ) : (
              <>
                Here for{" "}
                <span className="font-semibold">
                  {data.summary.present + data.summary.late} of {data.summary.eligible}
                </span>{" "}
                mornings since they joined.{" "}
                <span className="font-semibold">{formatPercent(data.summary.rate)}</span>
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Present {data.summary.present} · Late {data.summary.late} · Excused{" "}
            {data.summary.excused} · Absent {data.summary.absent + data.summary.unrecorded}
            {data.summary.excused > 0 && " — an excused morning still counts as one they missed."}
          </p>
          {/*
            The arrival averages, which are the detail per-course attendance used to carry. Under the
            rate rather than beside it because they answer different questions: the rate is whether
            somebody turns up, and this is when.
          */}
          <ArrivalAveragesPanel
            averages={data.arrivals}
            emptyNote="They have not checked in enough times yet for an average."
            className="border-t border-border pt-3"
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">Courses · {data.courses.length}</h2>
          <p className="text-xs text-muted-foreground">
            Every course of {data.program.matriculation}, because everybody on the roster is a student
            of all of them. Open one for what they have actually handed in.
          </p>
        </div>

        {data.courses.length === 0 ? (
          <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
            This matriculation has no courses yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {data.courses.map((course) => (
              <li key={course.id}>
                <Link
                  href={studentHref(course.id, data.student.id)}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm hover:bg-muted/50"
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-medium",
                      course.archivedAt !== null && "text-muted-foreground",
                    )}
                  >
                    {course.name}
                  </span>

                  {/*
                    Publication is said on the row because it changes what this fellow could possibly
                    have done. A verdict of "not finished" against a course they cannot see yet is
                    not a fact about them.
                  */}
                  {course.archivedAt !== null ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Archive className="size-3" />
                      Archived
                    </span>
                  ) : course.publishedAt === null ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                      <EyeOff className="size-3" />
                      Not published
                    </span>
                  ) : null}

                  {course.completion === "complete" ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      <CircleCheck className="size-3" />
                      Complete
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {course.completion === "incomplete" ? "Fell short" : "Not finished"}
                    </span>
                  )}

                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">General Coding Framework · {data.gcf.length}</h2>
          <p className="text-xs text-muted-foreground">
            Every sitting, whichever matriculation they were in at the time. A result carries no
            program — it is sat at CodeSignal on their own schedule — so somebody repeating a year has
            one history here rather than two halves of it.
          </p>
        </div>

        {data.gcf.length === 0 ? (
          <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
            They have not sat the GCF yet, real or mock.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {data.gcf.map((attempt) => (
              <li
                key={attempt.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {attempt.kind === "PROCTORED" ? "Proctored" : "Mock"}
                </span>
                <span className="shrink-0 tabular-nums">
                  {/*
                    The two kinds are never compared, so a proctored score is shown bare — it is a
                    calibrated index from 200 to 600 — and a mock is shown over its own possible,
                    which is however many tasks that one had.
                  */}
                  {attempt.scorePossible === null
                    ? attempt.score
                    : `${attempt.score} / ${attempt.scorePossible}`}
                </span>
                {attempt.integrityFlagged && (
                  <Badge variant="outline" className="shrink-0 font-normal text-destructive">
                    Integrity flag
                  </Badge>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatSchoolDay(attempt.takenOn.toISOString().slice(0, 10))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
