"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as React from "react";
import { Archive, Eye, EyeOff, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { countLabel, Detail } from "@/components/instructor/impact-detail";
import { NewCourseDialog } from "@/components/instructor/new-course-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { courseSettingsHref, programsHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { formatDate } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * The program itself: what it is, its courses, when a fellow counts as late, and how it is
 * retired.
 *
 * **The counterpart of the course's own settings screen, and the split is what the program above the
 * course bought.** Everything here is the same for every course of the year — the lateness rule, the
 * roster the courses share, the archive that retires all of them — so it is set once. What stayed on
 * the course is what genuinely differs between two courses of one year: its publication, its short
 * name, and its own retirement.
 *
 * **Its name and its term are facts rather than fields.** Both are in the unique key that tells two
 * years of one program apart, they are what the join link and every repository name were chosen
 * against, and a program somebody renamed in March would leave every reader of an older CSV holding
 * a name that no longer exists. Getting one wrong is a program created again, which is cheap: a
 * program is created empty.
 */

type Data = RouterOutputs["programs"]["settings"];

export function ProgramSettings({ data, courses }: { data: Data; courses: CopyableCourses }) {
  const archived = data.program.archivedAt !== null;

  return (
    <div className="flex flex-col gap-6">
      {/*
        The banner lives here, beside the control that caused it. It answers "why is nothing
        happening" across every course of the program at once, which is what archiving a
        program reaches.
      */}
      {archived && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            This program is archived. Every course in it is off everyone&apos;s active list and
            their submissions are out of grading triage, no attendance day can be started, and
            nobody new can join. Everything stays readable to the people who were in it.
          </p>
        </div>
      )}

      <IdentityCard data={data} />
      <CoursesCard data={data} courses={courses} />
      <AttendanceCard data={data} />
      <ArchiveCard data={data} />
      {/*
        Only on an archived program, and only for whoever owns it — the same two conditions the
        procedures enforce. A control that can destroy a year and then refuses is worse than one that
        is not there.
      */}
      {archived && data.callerActsAsOwner && <DeleteProgramCard data={data} />}
    </div>
  );
}

/** What `NewCourseDialog` needs to offer a course to copy from. */
type CopyableCourses = React.ComponentProps<typeof NewCourseDialog>["courses"];

/** Whoever the program belongs to, for the sentences that have to name them. */
function ownerNameIn(data: Data): string {
  const owner = data.program.instructors.find((row) => row.user.id === data.ownerId);
  return owner ? displayNameOf(owner.user, "its owner") : "its owner";
}

/**
 * What this program is, and when it was started.
 *
 * Read-only, and the doc comment above says why. It is here rather than left off the screen because
 * the term is what tells two years of one program apart everywhere else in the application — in the
 * switcher, in every breadcrumb, in the name of every exported file — and a screen called Settings
 * that did not show it would be the one place the reader could not check it.
 */
function IdentityCard({ data }: { data: Data }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{data.program.name}</h2>
        <p className="text-xs text-muted-foreground">
          {data.program.term} · started {formatDate(data.program.createdAt)} ·{" "}
          {countLabel(data.program.instructors.length, "instructor")}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        The name and the term are settled when the program is created. Together they are what tells
        this year of {data.program.name} from every other one — in the switcher, in every
        breadcrumb, and in the name of every file exported from it — so neither can be changed
        afterwards. A program is created empty, so one named by mistake is best created again.
      </p>
    </section>
  );
}

/**
 * The courses of this program, and where a new one is made.
 *
 * **This is where a course is created**, and not the course list. A course belongs to exactly one
 * program, so making one from a screen that spans every year would have to ask which year
 * first — a question this screen answers by being the screen somebody is already on.
 *
 * Publication is shown and not set here. It is the course's own control, on the course's own
 * settings screen, because that is where the short name and the archive live and all three are
 * decisions about one course. What this list is for is seeing at a glance which courses of the year
 * fellows can actually reach, which is the question somebody asks in the week a term starts.
 */
function CoursesCard({ data, courses }: { data: Data; courses: CopyableCourses }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Courses</h2>
          <p className="text-xs text-muted-foreground">
            Every course of {data.program.term}. Everybody on the roster is a student of all of
            them, so publishing is what decides which ones they can find yet.
          </p>
        </div>
        <NewCourseDialog programId={data.program.id} term={data.program.term} courses={courses} />
      </div>

      {data.program.courses.length === 0 ? (
        <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
          No courses yet. A program is created empty — add the first one, or copy last year&apos;s.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {data.program.courses.map((course) => (
            <li key={course.id}>
              <Link
                href={courseSettingsHref(course.id)}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{course.name}</span>
                <code className="shrink-0 font-mono text-xs text-muted-foreground">
                  {course.slug}
                </code>
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
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Eye className="size-3" />
                    Visible
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * How long after check-in opens a fellow still counts as on time.
 *
 * The program's own number, because it is one: a program that starts with fifteen minutes of
 * standup and one that starts with a quiz disagree about when the door closes, and neither is wrong.
 * **One value rather than one per course**, which is the duplication attendance moving up removed —
 * there is one morning, so there is one answer.
 *
 * **It applies to sessions started from now on and rewrites nothing.** Each session copies this when
 * it starts, which is what makes the setting editable at all — read live, changing it in November
 * would silently convert a term of recorded lateness and no report would agree with any report
 * printed before it. The sentence below says so, because somebody about to change it is exactly the
 * person who needs to know.
 */
function AttendanceCard({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [minutes, setMinutes] = React.useState(String(data.program.attendanceLateAfterMinutes));

  const save = useMutation(
    trpc.programs.setAttendanceLateAfter.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            result.attendanceLateAfterMinutes === 0
              ? "Arriving after check-in opens now counts as late."
              : `The first ${result.attendanceLateAfterMinutes} minutes now count as on time.`,
          ),
      }),
    ),
  );

  const parsed = Number(minutes);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 120;
  const changed = parsed !== data.program.attendanceLateAfterMinutes;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Attendance</h2>
        <p className="text-xs text-muted-foreground">
          One check-in a day for the whole program, however many courses somebody is taking. A
          session runs until you end it, or for ninety minutes — whichever comes first, and you can
          extend it while it is open.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) save.mutate({ programId: data.program.id, minutes: parsed });
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Minutes that still count as on time</span>
          <Input
            value={minutes}
            onChange={(event) => setMinutes(event.target.value.replace(/\D/g, "").slice(0, 3))}
            inputMode="numeric"
            className="w-24"
          />
        </label>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!valid || !changed || save.isPending}
        >
          Save
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Applies to sessions started from now on. Nothing already recorded changes — to correct a
        morning that was taken with the wrong number, open that day from the attendance screen.
      </p>
    </section>
  );
}

/**
 * Retiring a whole program, or bringing it back.
 *
 * Two clicks to archive and one to unarchive, deliberately asymmetric. Archiving is the one that
 * changes what every fellow on the roster sees, in every course at once, so it says what it will do
 * first; unarchiving only undoes it, and a confirmation on an undo is a confirmation nobody reads.
 *
 * **It reaches every course.** Archiving one course of the year is that course's own control, and it
 * is the right one for a prework course that ends in September while the fellowship runs on. This is
 * for the end of the year itself.
 *
 * **The owner's, in both directions.** Reopening is the same gate because it is the same mutation
 * with a boolean, and the consequence is worth stating: a co-teacher can read an archived
 * program in full and cannot bring it back.
 */
function ArchiveCard({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [confirming, setConfirming] = React.useState(false);

  const archived = data.program.archivedAt !== null;

  const setArchived = useMutation(
    trpc.programs.setArchived.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(
            result.archivedAt === null
              ? `${result.name} is active again.`
              : `${result.name} is archived.`,
          );
          setConfirming(false);
        },
      }),
    ),
  );

  const courseCount = data.program.courses.length;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">
          {archived ? "Reopen" : "Archive"} {data.program.term}
        </h2>
        <p className="text-xs text-muted-foreground">
          {archived
            ? `It is archived. Reopening puts its ${countLabel(courseCount, "course")} back on everyone's active list, lets work be handed in again, and lets an attendance day be started.`
            : `Archiving reaches all of it: ${countLabel(courseCount, "course")}, the roster, and the attendance. Fellows keep reading their feedback, nothing new can be handed in, and no morning can be opened. It is reversible.`}
        </p>
      </div>

      {!data.callerActsAsOwner ? (
        /*
          Said rather than shown as a disabled button. A control that cannot be used is a question —
          is it broken, am I doing it wrong — and the answer here is a fact about who to ask.
        */
        <p className="text-xs text-muted-foreground">
          Only {ownerNameIn(data)} can {archived ? "reopen" : "archive"} this program, because they
          own it. Everything else on this screen is yours as much as theirs.
        </p>
      ) : archived ? (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={setArchived.isPending}
          onClick={() => setArchived.mutate({ programId: data.program.id, archived: false })}
        >
          <RotateCcw data-icon="inline-start" />
          Reopen this program
        </Button>
      ) : confirming ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={setArchived.isPending}
            onClick={() => setArchived.mutate({ programId: data.program.id, archived: true })}
          >
            Archive — fellows keep their feedback
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => setConfirming(true)}
        >
          <Archive data-icon="inline-start" />
          Archive this program
        </Button>
      )}
    </section>
  );
}

/**
 * Deleting a program, which is the largest thing in this application that cannot be undone.
 *
 * **The counts come first and the confirmation second.** "This cannot be undone" is a generality
 * nobody reads; "4 courses, 24 fellows, 187 submissions, 143 released grades" is a sentence somebody
 * can weigh, and it is read before the box that unlocks the button rather than beside it.
 *
 * **The term is what has to be typed, not the name.** A program runs every year under the
 * same name, so typing "Software Engineering Fellowship" would confirm the wrong year as readily as
 * the right one — and the term is the thing that is unique to this one. That is the mirror image of
 * deleting a course, which asks for the short name because a program runs the same courses every
 * year. The procedure is what enforces it; this only decides when to offer the button.
 */
function DeleteProgramCard({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");

  // Only when asked for. It counts a year's worth of submissions, and this card sits at the bottom
  // of a screen most people open for the lateness rule.
  const impact = useQuery({
    ...trpc.programs.removalImpact.queryOptions({ programId: data.program.id }),
    enabled: open,
  });

  const remove = useMutation(
    trpc.programs.remove.mutationOptions(
      settled({
        onSuccess: (result) => {
          /*
            What was destroyed, and what was not. The two leftovers are named rather than implied —
            the repositories are still on GitHub and the files that would not go are in a bucket
            nothing points at any more, so this message is the only record of either.
          */
          const parts = [
            `${result.name} · ${result.term} is gone`,
            `${result.courses} ${result.courses === 1 ? "course" : "courses"}`,
            `${result.enrollments} ${result.enrollments === 1 ? "fellow" : "fellows"}`,
            `${result.submissions} ${result.submissions === 1 ? "submission" : "submissions"}`,
          ];
          if (result.orphanedRepositories.length > 0) {
            parts.push(
              `${result.orphanedRepositories.length} GitHub ${
                result.orphanedRepositories.length === 1 ? "repository is" : "repositories are"
              } untouched`,
            );
          }
          if (result.uploadsLeftBehind.length > 0) {
            parts.push(`${result.uploadsLeftBehind.length} uploaded files could not be removed`);
          }
          toast.success(parts.join(" · "), { duration: 12_000 });
          router.push(programsHref());
        },
      }),
    ),
  );

  const ready =
    typed.trim() !== "" && impact.data?.confirm.toLowerCase() === typed.trim().toLowerCase();

  if (!open) {
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Delete this program</h2>
          <p className="text-xs text-muted-foreground">
            Permanent, and the widest thing on any screen here. {data.program.name} ·{" "}
            {data.program.term} goes, and with it every course in it, their assignments and
            submissions and grades, the roster, the cohorts, and the whole attendance record. The
            database&apos;s own backups are the only way back. Archiving is the reversible version
            and this program is already archived.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="self-start text-destructive hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <Trash2 data-icon="inline-start" />
          Delete this program
        </Button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">
          Delete {data.program.name} · {data.program.term}?
        </h2>
        <p className="text-xs text-muted-foreground">
          There is no undo and no recovery path here. The database&apos;s own backups are the only
          way back.
        </p>
      </div>

      {impact.isPending ? (
        <p className="text-xs text-muted-foreground">Counting what would go…</p>
      ) : impact.data ? (
        <>
          <dl className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <Detail
              label="Courses"
              value={`${countLabel(impact.data.courses, "course")}, and everything in them`}
            />
            <Detail
              label="Roster"
              value={`${countLabel(impact.data.enrollments, "enrollment")} in ${countLabel(
                impact.data.cohorts,
                "cohort",
              )}`}
            />
            <Detail
              label="Attendance"
              value={`${countLabel(impact.data.attendanceSessions, "day")}, ${countLabel(
                impact.data.attendanceRecords,
                "record",
              )}`}
            />
            <Detail
              label="Submissions"
              value={`${impact.data.submissions}, of which ${impact.data.releasedGrades} carry a released grade`}
            />
            <Detail
              label="Also"
              value={`${countLabel(impact.data.instructors, "instructor row")}, ${countLabel(
                impact.data.drafts,
                "grading draft",
              )}, ${countLabel(impact.data.testRuns, "test run")}, ${countLabel(
                impact.data.uploadedFiles,
                "uploaded file",
              )}`}
            />
            {/*
              Named rather than counted silently, because this is the one thing here that survives: a
              fellow's repository holds their own work and they can reach it on GitHub whether or not
              this application still knows about it.
            */}
            <Detail
              label="Left alone"
              value={
                impact.data.repositories > 0
                  ? `${countLabel(impact.data.repositories, "GitHub repository")}, which stay exactly as they are`
                  : "No GitHub repositories were ever generated"
              }
            />
          </dl>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" htmlFor="confirm-term">
              Type <code className="font-mono">{impact.data.confirm}</code> to confirm
            </label>
            <Input
              id="confirm-term"
              value={typed}
              autoComplete="off"
              placeholder={impact.data.confirm}
              onChange={(event) => setTyped(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The term, not the name — every year of this program is called {impact.data.name}.
            </p>
          </div>
        </>
      ) : (
        <p className="text-xs text-destructive">
          {impact.error?.message ?? "Could not read what deleting this would destroy."}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={!ready || remove.isPending}
          onClick={() => remove.mutate({ programId: data.program.id, confirmTerm: typed.trim() })}
        >
          {remove.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
          Delete this program permanently
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={remove.isPending}
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          Keep it
        </Button>
      </div>
    </section>
  );
}
