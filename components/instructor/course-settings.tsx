"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as React from "react";
import {
  Archive,
  Eye,
  EyeOff,
  GitBranch,
  Loader2,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { countLabel, Detail } from "@/components/instructor/impact-detail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { studentRepoName } from "@/lib/courses/course-slug";
import { displayNameOf } from "@/lib/people";
import { programSettingsHref } from "@/lib/links";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * The course itself: what it is called, whether fellows can see it, how its repositories are named,
 * whose name is on it, and how it is retired.
 *
 * Also where the bare course address lands, because once every tab became a sidebar item there was
 * nothing else for `/instructor/courses/[courseId]` to be. That turns out to be the right answer
 * rather than a leftover: a reader who names a course and nothing more is asking about the course,
 * which is what this screen is.
 *
 * **The matriculation's own settings are a separate screen**, and the split is the whole shape of
 * this change. Attendance, the roster, the cohorts, the join link and the instructor link belong to
 * the program above this course and are the same for every course in it, so editing them here would
 * have been four places to change one fact. What is left is what is genuinely this course's: its
 * publication, its short name, and its two ways of being retired.
 */

type Data = RouterOutputs["courses"]["settings"];

export function CourseSettings({ data }: { data: Data }) {
  const archived = data.course.archivedAt !== null;

  return (
    <div className="flex flex-col gap-6">
      {/*
        The banner lives here and nowhere else now. It answers "why is nothing happening", and this
        is the screen holding the control that caused it — an explanation beside the button that did
        it, rather than repeated above every list in the course.
      */}
      {archived && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            This course is archived. It is off everyone&apos;s active course list and its submissions
            are out of grading triage. Everything stays readable to the people who were in it — the
            gradebook, and every assignment&apos;s own queue — and nothing new can be handed in.
          </p>
        </div>
      )}

      <NameCard data={data} />
      <PublishCard data={data} />
      <RepositoryNamingCard data={data} />
      <TeachingCard data={data} />
      <ArchiveCard
        courseId={data.course.id}
        archived={archived}
        name={data.course.name}
        canArchive={data.callerActsAsOwner}
        ownerName={ownerNameIn(data)}
      />
      {/*
        Only on an archived course, and only for whoever owns the matriculation — the same two
        conditions the procedures enforce. A destructive control that appears and then refuses is
        worse than one that is not there, and here it would appear on every course somebody teaches.
      */}
      {archived && data.callerActsAsOwner && (
        <DeleteCourseCard courseId={data.course.id} name={data.course.name} />
      )}
    </div>
  );
}

/** Whoever the matriculation belongs to, for the sentences that have to name them. */
function ownerNameIn(data: Data): string {
  const owner = data.course.program.instructors.find((row) => row.user.id === data.ownerId);
  return owner ? displayNameOf(owner.user, "its owner") : "its owner";
}

/**
 * What the course is called.
 *
 * **Editable, where the short name below is not, and the difference is the whole of this card.** The
 * name is display and only display: nothing looks a course up by it, no constraint holds it, and
 * every reader is showing it to somebody rather than matching on it. The short name is in the name
 * of every repository the course has generated, so changing it here would rename nothing on GitHub
 * and leave this application describing repositories that do not exist.
 *
 * Putting them next to each other is deliberate. "Why can I change one and not the other" is the
 * question somebody will have, and the two cards answer it by sitting together — the second says in
 * words what it would cost.
 *
 * Any instructor of the matriculation may, unlike publishing and archiving. Those decide whether a
 * fellow can reach the course at all; this decides what it is called, which is the same kind of act
 * as renaming a module.
 */
function NameCard({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [name, setName] = React.useState(data.course.name);

  const rename = useMutation(
    trpc.courses.rename.mutationOptions(
      settled({
        onSuccess: (result) => toast.success(`This course is called ${result.name} now.`),
      }),
    ),
  );

  const trimmed = name.trim();
  const changed = trimmed !== data.course.name;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Course name</h2>
        <p className="text-xs text-muted-foreground">
          What fellows see on their course list, what every heading in it says, and what a subscribed
          calendar names beside each deadline. Changing it changes all of them.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && trimmed !== "") {
            rename.mutate({ courseId: data.course.id, name: trimmed });
          }
        }}
      >
        <label className="flex min-w-64 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium">Name</span>
          <Input
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!changed || trimmed === "" || rename.isPending}
        >
          Save
        </Button>
        {changed && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={rename.isPending}
            onClick={() => setName(data.course.name)}
          >
            Discard
          </Button>
        )}
      </form>

      <p className="text-xs text-muted-foreground">
        The short name below is a different thing and cannot be changed — it is already in the name
        of every repository this course has generated.
      </p>
    </section>
  );
}

/**
 * Whether fellows can see this course at all.
 *
 * **This is what replaced "do not enrol anybody yet".** Being on a matriculation's roster now makes
 * somebody a student of every course in it, so not enrolling them is no longer available as the way
 * to keep a course that begins in March off a fellow's screen in September. One nullable timestamp
 * does it, and it means exactly what `Assignment.distributedAt` means: instructors author in it,
 * fellows do not see it.
 *
 * **Separate from archiving, and they must not be confused.** An unpublished course has not started;
 * an archived one has finished. A single flag would make a course somebody spent nine months on read
 * as one that never began, and the fellow who did the work would lose the record of it.
 *
 * Owner-gated, like archiving, because it changes what every fellow on the roster sees.
 */
function PublishCard({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const published = data.course.publishedAt !== null;

  const setPublished = useMutation(
    trpc.courses.setPublished.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            result.publishedAt === null
              ? `${result.name} is hidden from fellows again.`
              : `${result.name} is visible to everybody on the roster.`,
          ),
      }),
    ),
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{published ? "Visible to fellows" : "Not published"}</h2>
        <p className="text-xs text-muted-foreground">
          {published
            ? `Everybody on the ${data.course.program.matriculation} roster can open this course, see its published assignments, and hand work in.`
            : `Only this matriculation's instructors can see this course. Everybody on the ${data.course.program.matriculation} roster is already a student of it — publishing is what lets them find it.`}
        </p>
      </div>

      {!data.callerActsAsOwner ? (
        /*
          Said rather than shown as a disabled button, the same as archiving below. A control that
          cannot be used is a question; the answer here is a fact about who to ask.
        */
        <p className="text-xs text-muted-foreground">
          Only {ownerNameIn(data)} can {published ? "unpublish" : "publish"} this course, because
          they own the matriculation. Everything you author in it is yours as much as theirs.
        </p>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={setPublished.isPending}
          onClick={() =>
            setPublished.mutate({ courseId: data.course.id, published: !published })
          }
        >
          {published ? (
            <EyeOff data-icon="inline-start" />
          ) : (
            <Eye data-icon="inline-start" />
          )}
          {published ? "Hide from fellows" : "Publish to the roster"}
        </Button>
      )}

      {published && (
        <p className="text-xs text-muted-foreground">
          Unpublishing takes it off their list again and leaves everything in it untouched. Use it
          for a course that went out early; a course that has finished should be archived instead, so
          the people who did the work keep it in their record.
        </p>
      )}
    </section>
  );
}

/**
 * The short name, and what it does.
 *
 * **This is the one screen that shows it.** It used to be shown nowhere at all, on the reasoning
 * that it is fixed at creation and legible from any repository name the course has generated — which
 * is right about a screen that lists work and wrong about this one. An instructor who has to derive
 * their own course's short name by reading a fellow's repository has been told to work it out rather
 * than told.
 *
 * **It stays on the course rather than moving to the matriculation**, which is what keeps two
 * courses of one year able to hold an assignment with the same name: the short name is what tells
 * their repositories apart.
 *
 * The example is built with `studentRepoName`, the same function `accept` calls, so what this screen
 * promises and what GitHub receives cannot drift into disagreeing.
 */
function RepositoryNamingCard({ data }: { data: Data }) {
  const example = studentRepoName({
    courseSlug: data.course.slug,
    assignmentRepoName: "swe-1-4-loops",
    githubLogin: "student",
  });

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Short name</h2>
        <p className="text-xs text-muted-foreground">
          Every repository this course generates is named after it. It carries the course and the
          term, which is what keeps two courses of one matriculation — and two years of the same
          course — apart on GitHub.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
          {data.course.slug}
        </code>
        <span className="text-xs text-muted-foreground">
          {data.course.name} · {data.course.program.matriculation}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/30 p-3">
        <span className="text-xs font-medium text-muted-foreground">
          A repository-backed assignment produces
        </span>
        <code className="font-mono text-xs break-all">{example}</code>
        <span className="text-xs text-muted-foreground">
          The short name, then the assignment&apos;s repository name, then the fellow&apos;s GitHub
          login.
        </span>
      </div>

      {/*
        Why there is no edit control, said once rather than left as an absence somebody goes looking
        for. The count is the reason it could not be changed even if there were.
      */}
      <p className="text-xs text-muted-foreground">
        {data.acceptedCount > 0 ? (
          <>
            It cannot be changed. {data.acceptedCount}{" "}
            {data.acceptedCount === 1 ? "repository has" : "repositories have"} already been
            generated under it, and renaming here would not rename any of them.
          </>
        ) : (
          <>
            It is settled when the course is created and cannot be changed afterwards. Nothing has
            been generated under it yet, so a course created by mistake is best created again.
          </>
        )}
      </p>

      {data.githubOrgs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {data.githubOrgs.length > 1 ? "Organizations" : "Organization"}
          </span>
          {data.githubOrgs.map((org) => (
            <code key={org} className="font-mono text-xs">
              {org}
            </code>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Whose name is on this course, read here and changed elsewhere.
 *
 * **Being assigned to a course grants nothing and withholds nothing**, which is the decision this
 * card exists to state. Every instructor of the matriculation can already author in every course of
 * it, read every fellow's work, and approve grades — `assertTeaches` asks for a `ProgramInstructor`
 * row and never for this one. What being assigned decides is whose name is on the course, who is
 * added as a collaborator on the repositories it generates, and which course an instructor's screens
 * open on.
 *
 * So it is a list and a link rather than a control. Changing it is one decision about a whole
 * matriculation — who works which course — and it is made once on the program's settings screen
 * rather than course by course, where four screens would each hold a quarter of the answer.
 */
function TeachingCard({ data }: { data: Data }) {
  const assigned = new Set(data.course.instructors.map((row) => row.userId));
  const teaching = data.course.program.instructors.filter((row) => assigned.has(row.user.id));
  const others = data.course.program.instructors.filter((row) => !assigned.has(row.user.id));

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Who teaches this course</h2>
        <p className="text-xs text-muted-foreground">
          Every instructor of {data.course.program.name} · {data.course.program.matriculation} can
          author in this course, read every fellow&apos;s work, and approve grades. Being named here
          decides whose course it is called, who is added as a collaborator on the repositories it
          generates, and which course their screens open on.
        </p>
      </div>

      {teaching.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nobody is assigned to this course yet. Fellows see no instructor named on it, and nobody is
          added as a collaborator on the repositories it generates.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {teaching.map((row) => (
            <li key={row.id} className="flex items-center gap-2 text-sm">
              <Users className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{displayNameOf(row.user, "Unnamed")}</span>
              {row.user.id === data.ownerId && (
                <span className="shrink-0 text-xs text-muted-foreground">owns the program</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {others.length > 0 && (
          <>
            {countLabel(others.length, "other instructor")} of this matriculation{" "}
            {others.length === 1 ? "is" : "are"} not named on this course, and can still work in it.{" "}
          </>
        )}
        <Link
          href={programSettingsHref(data.course.program.id)}
          className="underline underline-offset-4"
        >
          Change who teaches what
        </Link>{" "}
        on the matriculation&apos;s settings screen.
      </p>
    </section>
  );
}

/**
 * Retiring a course, or bringing it back.
 *
 * Two clicks to archive and one to unarchive, deliberately asymmetric. Archiving is the one that
 * changes what every fellow on the roster sees, so it says what it will do first; unarchiving only
 * undoes it, and a confirmation on an undo is a confirmation nobody reads.
 *
 * **Per course rather than per matriculation, and both exist.** Courses of one year finish at
 * different times — a prework course ends in September while the fellowship runs to June — so
 * archiving one must not retire the rest. Archiving the whole matriculation is the program's own
 * control and reaches every course in it.
 *
 * **The owner's, in both directions.** This is one of the two actions a single instructor takes that
 * changes what every fellow sees. Reopening is the same gate because it is the same mutation with a
 * boolean, and the consequence is worth stating on the screen: a co-teacher can read an archived
 * course in full and cannot bring it back.
 */
function ArchiveCard({
  courseId,
  archived,
  name,
  canArchive,
  ownerName,
}: {
  courseId: string;
  archived: boolean;
  name: string;
  /** Whether this caller owns the matriculation, or is an admin, which acts as owner everywhere. */
  canArchive: boolean;
  ownerName: string;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [confirming, setConfirming] = React.useState(false);

  const setArchived = useMutation(
    trpc.courses.setArchived.mutationOptions(
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

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{archived ? "Reopen" : "Archive"} this course</h2>
        <p className="text-xs text-muted-foreground">
          {archived
            ? `${name} is archived. Reopening puts it back on everyone's active course list and lets work be handed in again.`
            : "Archiving takes the course off everyone’s active course list and its submissions out of grading triage. Fellows keep reading their feedback, and nothing new can be handed in. It is reversible, and it leaves the rest of the matriculation running."}
        </p>
      </div>

      {!canArchive ? (
        <p className="text-xs text-muted-foreground">
          Only {ownerName} can {archived ? "reopen" : "archive"} this course, because they own the
          matriculation. Everything else you do in it is yours as much as theirs.
        </p>
      ) : archived ? (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={setArchived.isPending}
          onClick={() => setArchived.mutate({ courseId, archived: false })}
        >
          <RotateCcw data-icon="inline-start" />
          Reopen course
        </Button>
      ) : confirming ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={setArchived.isPending}
            onClick={() => setArchived.mutate({ courseId, archived: true })}
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
          Archive course
        </Button>
      )}
    </section>
  );
}

/**
 * Deleting a course, which cannot be undone.
 *
 * **The counts come first and the confirmation second.** "This cannot be undone" is a generality
 * nobody reads; "187 submissions, 143 released grades" is a sentence somebody can weigh, and it is
 * read before the box that unlocks the button rather than beside it. Same shape as removing an
 * assignment, at the grain of a whole course.
 *
 * **It leaves the roster standing**, which is the difference from deleting the matriculation and the
 * reason the impact list names the roster size without counting it as a loss. Enrollments, cohorts
 * and attendance belong to the program: deleting one course of four leaves everybody exactly where
 * they were, in the other three.
 *
 * The short name is what has to be typed, not the course name. A program runs the same courses every
 * year, so typing "Fullstack Software Engineering" would confirm the wrong year's as readily as the
 * right one — and the short name is the thing that is unique to this one. The procedure is what
 * enforces it; this only decides when to offer the button.
 */
function DeleteCourseCard({ courseId, name }: { courseId: string; name: string }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");

  // Only when asked for. It counts a term's worth of submissions, and this card sits at the bottom
  // of a screen most people open to read a repository name.
  const impact = useQuery({
    ...trpc.courses.removalImpact.queryOptions({ courseId }),
    enabled: open,
  });

  const remove = useMutation(
    trpc.courses.remove.mutationOptions(
      settled({
        onSuccess: (result) => {
          /*
            What was destroyed, and what was not. The two leftovers are named rather than implied —
            the repositories are still on GitHub and the files that would not go are in a bucket
            nothing points at any more, so this message is the only record of either.
          */
          const parts = [
            `${result.name} is gone`,
            `${result.assignments} ${result.assignments === 1 ? "assignment" : "assignments"}`,
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
          router.push("/courses");
        },
      }),
    ),
  );

  const ready = typed.trim() !== "" && impact.data?.slug === typed.trim().toLowerCase();

  if (!open) {
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Delete this course</h2>
          <p className="text-xs text-muted-foreground">
            Permanent. {name} and everything in it — assignments, submissions, grades, and the
            feedback that was given — go, and the database&apos;s own backups are the only way back.
            The roster, the cohorts and the attendance belong to the matriculation and stay.
            Archiving is the reversible version and this course is already archived.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="self-start text-destructive hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <Trash2 data-icon="inline-start" />
          Delete course
        </Button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Delete {name}?</h2>
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
              label="Assignments"
              value={`${impact.data.assignments} in ${countLabel(impact.data.courseUnits, "unit")}`}
            />
            <Detail
              label="Submissions"
              value={`${impact.data.submissions}, of which ${impact.data.releasedGrades} carry a released grade`}
            />
            <Detail
              label="Also"
              value={`${countLabel(impact.data.drafts, "grading draft")}, ${countLabel(
                impact.data.testRuns,
                "test run",
              )}, ${countLabel(impact.data.uploadedFiles, "uploaded file")}`}
            />
            {/*
              The roster, named as something that survives rather than counted as a loss. It belongs
              to the matriculation, so a reader weighing this needs to know it is the denominator of
              the numbers above and not one of them.
            */}
            <Detail
              label="Stays"
              value={
                `${countLabel(impact.data.enrollments, "fellow")} on the ` +
                `${impact.data.matriculation} roster, with their cohorts and attendance`
              }
            />
            {/*
              Named rather than counted silently, because this is the other thing here that survives:
              a fellow's repository holds their own work and they can reach it on GitHub whether or
              not this application still knows about it.
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
            <label className="text-xs font-medium" htmlFor="confirm-course">
              Type <code className="font-mono">{impact.data.slug}</code> to confirm
            </label>
            <Input
              id="confirm-course"
              value={typed}
              autoComplete="off"
              className="font-mono"
              placeholder={impact.data.slug}
              onChange={(event) => setTyped(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The course&apos;s short name, not its name — every year of this program runs a course
              called {name}.
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
          onClick={() => remove.mutate({ courseId, confirmSlug: typed.trim() })}
        >
          {remove.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
          Delete this course permanently
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
