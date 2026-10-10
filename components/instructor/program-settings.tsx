"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as React from "react";
import { Archive, Eye, EyeOff, FlaskConical, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { countLabel, Detail } from "@/components/instructor/impact-detail";
import { NewCourseDialog } from "@/components/instructor/new-course-dialog";
import { SortableList, SortableRow } from "@/components/sortable-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DISCIPLINES,
  DISCIPLINE_ITEMS,
  DISCIPLINE_META,
  type Discipline,
} from "@/lib/competencies";
import { competenciesHref, programsHref, triageHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { formatDate } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";
import { ProgramInstructors } from "@/components/instructor/program-instructors";

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
            This program is archived. Everything stays readable, but nothing new can be handed in.
          </p>
        </div>
      )}

      {/*
        Ordered by how often somebody comes for each. What the program is and what it teaches are
        read in the first week of a term; who instructs it is read when somebody joins or leaves;
        and ending the year is read at the end of the year. Attendance is set up on its own screen.
      */}
      <IdentityCard data={data} />
      <CoursesCard data={data} courses={courses} />
      <ProgramInstructors data={data} />
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
 * What this program is: its name and term, when it was started, which fellowship it runs, and
 * whether it is a rehearsal.
 *
 * The name and the term are read-only, and the doc comment above says why. They are shown rather
 * than left off the screen because the term is what tells two years of one program apart everywhere
 * else in the application — in the switcher, in every breadcrumb, in the name of every exported
 * file — and a screen called Settings that did not show it would be the one place the reader could
 * not check it.
 *
 * The discipline and the test flag live in this card rather than in cards of their own because all
 * four are facts about what the program *is*, where the courses, the instructors and the archive
 * below are things it *does*.
 */
function IdentityCard({ data }: { data: Data }) {
  return (
    <section
      id="program"
      className="scroll-mt-(--outline-offset) flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{data.program.name}</h2>
        <p className="text-xs text-muted-foreground">
          {data.program.term} · started {formatDate(data.program.createdAt)} ·{" "}
          {countLabel(data.program.instructors.length, "instructor")}
        </p>
        <p className="text-xs text-muted-foreground">
          The name and term cannot be changed. If either is wrong, create the program again.
        </p>
      </div>
      <DisciplineField data={data} />
      <TestProgramField data={data} />
    </section>
  );
}

/**
 * Which fellowship this program runs, and so which competencies its fellows set goals against.
 *
 * **A field, where the name and the term above are facts.** Those two are half of the program's
 * identity each; this one decides which part of the competency list the goal picker offers, and
 * nothing else. Changing it does not touch a goal already set: a goal keeps its own copy of the
 * wording it was built on, so a fellow moved between fellowships keeps reading exactly what they
 * wrote.
 *
 * Saved on choosing rather than behind a Save button, which is the one-control-one-act shape: the
 * select has nothing to be submitted alongside.
 */
function DisciplineField({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const save = useMutation(
    trpc.programs.setDiscipline.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            `Fellows of this program now set goals from the ${
              DISCIPLINE_META[result.discipline].label
            } competencies.`,
          ),
      }),
    ),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium" htmlFor="discipline">
        Discipline
      </label>
      <Select
        value={data.program.discipline}
        items={DISCIPLINE_ITEMS}
        onValueChange={(value) =>
          value && save.mutate({ programId: data.program.id, discipline: value as Discipline })
        }
      >
        <SelectTrigger id="discipline" className="w-full sm:w-72" disabled={save.isPending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DISCIPLINES.map((option) => (
            <SelectItem key={option} value={option}>
              {DISCIPLINE_META[option].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Decides which{" "}
        <Link href={competenciesHref()} className="underline underline-offset-2">
          competencies
        </Link>{" "}
        fellows set goals against. Changing it does not change goals already set.
      </p>
    </div>
  );
}

/**
 * Whether this program is a rehearsal.
 *
 * **It changes the Salesforce feed and nothing else**, and marking a real program by mistake is
 * silent: the feed simply stops carrying the term, nothing in this application looks any different,
 * and Salesforce keeps whatever it already holds. So the sentence states which of the two a reader
 * is looking at and names the consequence rather than the setting.
 */
function TestProgramField({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const isTest = data.program.isTest;

  const setTest = useMutation(
    trpc.programs.setTest.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            result.isTest
              ? `${result.name} is a test program. Nothing in it is sent to Salesforce.`
              : `${result.name} is a real program again, and will be sent to Salesforce.`,
          ),
      }),
    ),
  );

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        disabled={setTest.isPending}
        onClick={() => setTest.mutate({ programId: data.program.id, isTest: !isTest })}
      >
        <FlaskConical data-icon="inline-start" />
        {isTest ? "Mark as a real program" : "Mark as a test program"}
      </Button>
      <p className="text-xs text-muted-foreground">
        {isTest
          ? "Nothing in this program is sent to Salesforce."
          : "Mark as a test to keep this program out of Salesforce."}
      </p>
    </div>
  );
}

/** One course's row, drawn the same whether or not there is a handle in front of it. */
function CourseRow({ course }: { course: Data["program"]["courses"][number] }) {
  return (
    <Link
      href={triageHref(course.id)}
      className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-muted/50"
    >
      <span className="min-w-0 flex-1 truncate font-medium">{course.name}</span>
      <code className="shrink-0 font-mono text-xs text-muted-foreground">{course.slug}</code>
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
  );
}

/**
 * The courses of this program, in the order they are read in, which the owner sets by dragging.
 *
 * **This is where a course is created**, and not the course list. Publication
 * is shown and not set here: it is the course's own control, on the course's own settings screen.
 *
 * **The order reaches every list of them** — this card, and the sidebar for every instructor and
 * every fellow of the program. It was creation order everywhere before, which made the order an
 * accident of which course somebody happened to add first.
 *
 * **Only the owner may change it, and only the handle drags.** Ownership is a program fact, so a
 * co-teaching instructor sees the list exactly as it is drawn for a fellow: rows that are links and
 * nothing else. The handle is separate from the link for the reason `SortableList` gives — a
 * row-wide drag listener and a navigation on the same element fight each other.
 */
function CoursesCard({ data, courses }: { data: Data; courses: CopyableCourses }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const fromServer = data.program.courses;
  const serverOrder = fromServer.map((course) => course.id).join(" ");

  /*
    The order to draw while a move is in flight, or null when the server's own order is the one to
    draw. A drag has to move the row under the pointer immediately, and this screen is server
    rendered — `settled()` refreshes it, which is a round trip, and a list that waited for it would
    spring back under the hand that moved it.

    `basedOn` is what retires the local order: when a refresh brings a different list, whatever
    this held is about a list that no longer exists. That covers the move landing, and it covers
    somebody else adding or removing a course while this was open.
  */
  const [dragged, setDragged] = React.useState<string[] | null>(null);
  const [basedOn, setBasedOn] = React.useState(serverOrder);

  if (basedOn !== serverOrder) {
    setBasedOn(serverOrder);
    setDragged(null);
  }

  const reorder = useMutation(
    trpc.courses.reorder.mutationOptions(
      settled({
        /*
          Put the order back and say why. The procedure's own refusal reads "Reload the page and try
          again — someone may have added or removed one", which is the case this is for.
        */
        onError: (error) => {
          setDragged(null);
          toast.error(error.message);
        },
      }),
    ),
  );

  const byId = new Map(fromServer.map((course) => [course.id, course]));
  const ordered = (dragged ?? fromServer.map((course) => course.id))
    .map((id) => byId.get(id))
    .filter((course) => course !== undefined);

  /* Nothing to drag with one row, and nothing to offer somebody who would be refused. */
  const mayReorder = data.callerActsAsOwner && ordered.length > 1;

  function move(ids: string[]) {
    setDragged(ids);
    reorder.mutate({ programId: data.program.id, courseIds: ids });
  }

  const list = (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
      {ordered.map((course) =>
        mayReorder ? (
          <SortableRow key={course.id} id={course.id} label={course.name} as="li">
            {(handle) => (
              <div className="flex items-center bg-background pl-2">
                {handle}
                <CourseRow course={course} />
              </div>
            )}
          </SortableRow>
        ) : (
          <li key={course.id} className="flex">
            <CourseRow course={course} />
          </li>
        ),
      )}
    </ul>
  );

  return (
    <section
      id="courses"
      className="scroll-mt-(--outline-offset) flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Courses</h2>
          <p className="text-xs text-muted-foreground">
            Everyone on the roster is automatically enrolled in every published course.
          </p>
        </div>
        <NewCourseDialog programId={data.program.id} term={data.program.term} courses={courses} />
      </div>

      {ordered.length === 0 ? (
        <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
          No courses yet. Add one, or copy last year&apos;s.
        </p>
      ) : mayReorder ? (
        <>
          {/*
            `announce` is given an id because that is all `SortableList` has; the name is what an
            instructor needs to hear.
          */}
          <SortableList
            ids={ordered.map((course) => course.id)}
            onReorder={move}
            announce={(id) => byId.get(id)?.name ?? "this course"}
          >
            {list}
          </SortableList>
          <p className="text-xs text-muted-foreground">
            The order here is how it will appear for everyone.
          </p>
        </>
      ) : (
        list
      )}
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
    <section
      id="archive"
      className="scroll-mt-(--outline-offset) flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">
          {archived ? "Reopen" : "Archive"} {data.program.term}
        </h2>
        {!archived && (
          <p className="text-xs text-muted-foreground">
            Archives all {countLabel(courseCount, "course")}. Fellows keep their feedback, but
            nothing new can be handed in. This can be undone.
          </p>
        )}
      </div>

      {!data.callerActsAsOwner ? (
        /*
          Said rather than shown as a disabled button. A control that cannot be used is a question —
          is it broken, am I doing it wrong — and the answer here is a fact about who to ask.
        */
        <p className="text-xs text-muted-foreground">
          Only {ownerNameIn(data)}, the owner, can {archived ? "reopen" : "archive"} this program.
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
      <section
        id="delete"
        className="scroll-mt-(--outline-offset) flex flex-col gap-3 rounded-lg border border-destructive/40 p-4"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Delete this program</h2>
          <p className="text-xs text-muted-foreground">
            Permanently deletes {data.program.name} · {data.program.term}: every course, assignment,
            submission, and grade, the roster, and the attendance record. This cannot be undone.
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
    <section
      id="delete"
      className="scroll-mt-(--outline-offset) flex flex-col gap-3 rounded-lg border border-destructive/40 p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">
          Delete {data.program.name} · {data.program.term}?
        </h2>
        <p className="text-xs text-muted-foreground">This cannot be undone.</p>
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
