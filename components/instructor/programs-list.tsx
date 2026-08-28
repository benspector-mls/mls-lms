"use client";

import Link from "next/link";
import { Archive, ArrowRight, CalendarCheck, Settings, UserMinus, Users } from "lucide-react";

import { NewProgramDialog } from "@/components/instructor/new-program-dialog";
import { EmptyState } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { attendanceHref, programSettingsHref, rosterHref } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Every program the caller belongs to, and the way out of all of them.
 *
 * **The instructor's top-level screen.** It lists the years; the sidebar's course group lists the
 * courses inside the one being read. The two answer different questions — "which term am I working
 * in" and "which course am I opening" — and the sidebar's two groups are the same split.
 *
 * **There is no program home to link to**, which is why each card offers three doors rather than one.
 * A program is not a screen; it is a roster, a set of mornings, and a set of courses, and a card
 * that led to one of them arbitrarily would be choosing for the reader. The roster comes first because
 * it is what everything else is about.
 *
 * Archived programs are in a section beneath the running ones rather than mixed in: a finished
 * year is not something anybody is working in, and a list that made no distinction would put the year
 * before last beside this week.
 */

type Program = RouterOutputs["programs"]["listMine"][number];

export function ProgramsList({
  programs,
  canCreate,
}: {
  programs: Program[];
  /**
   * Whether to offer starting one. Any instructor may — a program belongs to whoever runs it —
   * and the procedure is what refuses, so this only decides whether the button is there.
   */
  canCreate: boolean;
}) {
  const running = programs.filter((program) => program.archivedAt == null);
  const archived = programs.filter((program) => program.archivedAt != null);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Programs"
        description="Every program you belong to."
        actions={canCreate ? <NewProgramDialog /> : undefined}
      />

      {programs.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No programs yet"
          description={
            canCreate
              ? "Start one, then add its courses and send the roster its join link."
              : "When you are added to a program, it will appear here."
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {running.length > 0 ? (
            <div className="flex flex-col gap-3">
              {running.map((program) => (
                <ProgramCard key={program.id} program={program} />
              ))}
            </div>
          ) : (
            /*
              Said rather than left as an empty page above a list. Everything the caller belongs to
              being archived is a real state — the months between two programs — and a screen
              showing only the archived section reads as a bug otherwise.
            */
            <EmptyState
              icon={<Archive />}
              title="Nothing running right now"
              description="Every program you belong to has been archived. They are below, and they stay readable."
            />
          )}

          {archived.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5 border-t border-border pt-5">
                <h2 className="text-sm font-medium">Archived</h2>
                <p className="text-xs text-muted-foreground">
                  Finished programs. Everything in them stays readable — the work, the grades, the
                  feedback that was given, and the whole attendance record — and nothing new can be
                  handed in.
                </p>
              </div>
              {archived.map((program) => (
                <ProgramCard key={program.id} program={program} />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ProgramCard({ program }: { program: Program }) {
  const archived = program.archivedAt != null;
  const removed = program.enrolledAs === "REMOVED";

  return (
    <Card className={cn((archived || removed) && "opacity-80")}>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Users className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-balance text-foreground">
                {program.name}
              </h2>
              {archived && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <Archive className="size-3" />
                  Archived
                </span>
              )}
              {/*
                Said on the card rather than only inside the program, because this is where
                somebody would otherwise be misled: a year they have left, sitting in the same list
                as the ones they are in.
              */}
              {removed && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <UserMinus className="size-3" />
                  No longer enrolled
                </span>
              )}
            </div>
            {/*
              The term first, because it is what tells two rows with the same name apart, and then
              the two figures that say how big this year is.
            */}
            <p className="mt-0.5 text-sm text-muted-foreground">
              {program.term} · {program._count.courses}{" "}
              {program._count.courses === 1 ? "course" : "courses"} · {program._count.enrollments}{" "}
              {program._count.enrollments === 1 ? "fellow" : "fellows"}
            </p>
          </div>
        </div>

        {/*
          Three doors rather than one, because a program has no front page — see the note above.
          Only for somebody who instructs it: a fellow reading this list has their own attendance page
          and their own course list, and every screen behind these would refuse them.
        */}
        {program.instructs && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <CardLink href={rosterHref(program.id)} icon={<Users className="size-3.5" />}>
              Roster
            </CardLink>
            <CardLink
              href={attendanceHref(program.id)}
              icon={<CalendarCheck className="size-3.5" />}
            >
              Attendance
            </CardLink>
            <CardLink
              href={programSettingsHref(program.id)}
              icon={<Settings className="size-3.5" />}
            >
              {program._count.courses === 0 ? "Add a course" : "Settings"}
            </CardLink>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CardLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
    >
      {icon}
      {children}
      <ArrowRight className="size-3 text-muted-foreground" />
    </Link>
  );
}
