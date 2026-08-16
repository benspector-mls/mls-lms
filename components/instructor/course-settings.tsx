"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  Archive,
  Check,
  Copy,
  GitBranch,
  KeyRound,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserMinus,
} from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { studentRepoName } from "@/lib/courses/cohort-slug";
import { initials } from "@/lib/people";
import { formatDate } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * The cohort itself: what it is called, how its repositories are named, who teaches it, and
 * how it is retired.
 *
 * Also where the bare course address lands, because once every tab became a sidebar item there
 * was nothing else for `/instructor/courses/[courseId]` to be. That turns out to be the right
 * answer rather than a leftover: a reader who names a cohort and nothing more is asking about
 * the cohort, which is what this screen is.
 *
 * Everything here is either a fact about the course that cannot be changed, or one of the two
 * actions that change the whole of it. The lists — assignments, roster, gradebook — are their
 * own screens.
 */

type Data = RouterOutputs["courses"]["settings"];

export function CourseSettings({ data }: { data: Data }) {
  const archived = data.course.archivedAt !== null;

  return (
    <div className="flex flex-col gap-6">
      {/*
        The banner lives here and nowhere else now. It answers "why is nothing happening",
        and this is the screen holding the control that caused it — an explanation beside the
        button that did it, rather than repeated above every list in the cohort.
      */}
      {archived && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            This cohort is archived. It is off everyone&apos;s active course list and its
            submissions are out of grading triage. Everything stays readable to the people who were
            in it — the gradebook, and every assignment&apos;s own queue — and nothing new can be
            handed in.
          </p>
        </div>
      )}

      <RepositoryNamingCard data={data} />
      <AttendanceCard data={data} />
      <CoTeachingCard data={data} />
      <ArchiveCard
        courseId={data.course.id}
        archived={archived}
        name={data.course.name}
        canArchive={data.callerActsAsOwner}
        ownerName={ownerNameIn(data)}
      />
      {/*
        Only on an archived cohort, and only for whoever owns it — the same two conditions the
        procedures enforce. A destructive control that appears and then refuses is worse than
        one that is not there, and here it would appear on every cohort somebody is teaching.
      */}
      {archived && data.callerActsAsOwner && (
        <DeleteCourseCard courseId={data.course.id} name={data.course.name} />
      )}
    </div>
  );
}

/** Whoever the cohort belongs to, for the sentences that have to name them. */
function ownerNameIn(data: Data): string {
  const owner = data.course.instructors.find((row) => row.user.id === data.ownerId);
  if (!owner) return "its owner";
  return owner.user.displayName ?? owner.user.githubUsername ?? owner.user.email ?? "its owner";
}

/**
 * How long after check-in opens a fellow still counts as on time.
 *
 * A cohort's own number, because it is one: a course that starts with fifteen minutes of standup
 * and one that starts with a quiz disagree about when the door closes, and neither is wrong.
 *
 * **It applies to sessions started from now on and rewrites nothing.** Each session copies this
 * when it starts, which is what makes the setting editable at all — read live, changing it in
 * November would silently convert a term of recorded lateness and no report would agree with any
 * report printed before it. The sentence below says so, because somebody about to change it is
 * exactly the person who needs to know.
 */
function AttendanceCard({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [minutes, setMinutes] = React.useState(String(data.course.attendanceLateAfterMinutes));

  const save = useMutation(
    trpc.courses.setAttendanceLateAfter.mutationOptions(
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
  const changed = parsed !== data.course.attendanceLateAfterMinutes;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Attendance</h2>
        <p className="text-xs text-muted-foreground">
          A check-in session runs until you end it, or for ninety minutes — whichever comes first,
          and you can extend it while it is open.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) save.mutate({ courseId: data.course.id, minutes: parsed });
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
 * The short name, and what it does.
 *
 * **This is the one screen that shows it.** It used to be shown nowhere at all, on the
 * reasoning that it is fixed at creation and legible from any repository name the cohort has
 * generated — which is right about a screen that lists work and wrong about this one. An
 * instructor who has to derive their own cohort's short name by reading a student's repository
 * has been told to work it out rather than told.
 *
 * The example is built with `studentRepoName`, the same function `accept` calls, so what this
 * screen promises and what GitHub receives cannot drift into disagreeing.
 */
function RepositoryNamingCard({ data }: { data: Data }) {
  const example = studentRepoName({
    cohortSlug: data.course.cohortSlug,
    assignmentRepoName: "swe-1-4-loops",
    githubLogin: "student",
  });

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Short name</h2>
        <p className="text-xs text-muted-foreground">
          Every repository this cohort generates is named after it. It carries the course and the
          term, which is what keeps two programs starting the same season — and two cohorts of the
          same program — apart on GitHub.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
          {data.course.cohortSlug}
        </code>
        <span className="text-xs text-muted-foreground">
          {data.course.name} · {data.course.cohortTerm}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/30 p-3">
        <span className="text-xs font-medium text-muted-foreground">
          A repository-backed assignment produces
        </span>
        <code className="font-mono text-xs break-all">{example}</code>
        <span className="text-xs text-muted-foreground">
          The short name, then the assignment&apos;s repository name, then the student&apos;s GitHub
          login.
        </span>
      </div>

      {/*
        Why there is no edit control, said once rather than left as an absence somebody goes
        looking for. The count is the reason it could not be changed even if there were.
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
            been generated under it yet, so a cohort created by mistake is best created again.
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
 * Who else teaches this cohort, who owns it, and the link that adds somebody.
 *
 * **The link grants a course, never a role.** Only an account that is already an instructor or
 * an admin can redeem it; a student opening it is refused and told an admin has to send them an
 * instructor invitation first. A course-level link that made somebody staff would be a second
 * path to staff access with no admin involved, which is the escalation the Admin screen exists
 * to control.
 *
 * Reusable rather than single use, unlike an instructor invitation, because a cohort gains
 * co-teachers one at a time over a term. What bounds it is the role check rather than the token
 * being spent, and replacing it is the control over a link that reached the wrong person.
 *
 * **Everybody here can do the same work; the owner decides two more things.** Every instructor
 * authors, reads every student's work, and approves grades. The owner additionally archives the
 * cohort and says who else teaches it — the two actions with reach beyond the person performing
 * them. Before that distinction existed, anybody who taught a course could remove the person
 * who set it up.
 */
function CoTeachingCard({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [copied, setCopied] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  // Built in the browser, because the server rendering this has no reliable idea what host the
  // instructor is looking at — a preview deployment and production share the same code.
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  const link = origin
    ? `${origin}/co-teach/${data.course.coTeachToken}`
    : `/co-teach/${data.course.coTeachToken}`;

  const regenerate = useMutation(
    trpc.courses.regenerateCoTeachToken.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("New co-teaching link. The old one no longer works.");
        },
      }),
    ),
  );

  const removeInstructor = useMutation(
    trpc.courses.removeInstructor.mutationOptions(
      settled({
        onSuccess: (result) => {
          /*
            Who owns it now, when that changed. An owner who leaves without handing the cohort on
            gives it to the longest-serving instructor left — the right default, and not a thing
            anybody would guess, so it is said rather than left to be noticed.
          */
          toast.success(
            result.newOwnerName
              ? `${result.instructorName} no longer teaches this cohort. ${result.newOwnerName} owns it now.`
              : `${result.instructorName} no longer teaches this cohort.`,
          );
        },
      }),
    ),
  );

  const transfer = useMutation(
    trpc.courses.transferOwnership.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(`${result.ownerName} owns this cohort now.`);
        },
      }),
    ),
  );

  const busy = regenerate.isPending || removeInstructor.isPending || transfer.isPending;
  const onlyOne = data.course.instructors.length <= 1;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Instructors</h2>
        <p className="text-xs text-muted-foreground">
          Everyone here can author assignments in this cohort, read every student&apos;s work, and
          approve grades.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Instructor</TableHead>
              <TableHead className="hidden sm:table-cell">GitHub</TableHead>
              <TableHead className="hidden md:table-cell">Since</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.course.instructors.map((row) => {
              const name =
                row.user.displayName ?? row.user.githubUsername ?? row.user.email ?? "Unnamed";
              const isCaller = row.user.id === data.callerId;
              const isOwner = row.user.id === data.ownerId;

              /*
                The owner can leave, and nobody else can remove them.

                Leaving is a decision about your own work; removing the person who runs a
                cohort is a decision about theirs. The procedure refuses either way — this only
                decides whether the button is offered, and offering one that always fails is
                worse than not offering it.
              */
              const mayRemove = isOwner ? isCaller || data.callerActsAsOwner : true;

              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                          {initials(row.user.displayName ?? row.user.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-2 truncate font-medium">
                          {name}
                          {/* Whose cohort this is. Read from `ownerId`, which the server
                              derived — `isPrimary` is only half the rule, and a row can hold
                              none of it while the course still has an owner. */}
                          {isOwner && (
                            <Badge variant="secondary" className="font-normal">
                              Owner
                            </Badge>
                          )}
                          {isCaller && (
                            <span className="text-xs font-normal text-muted-foreground">you</span>
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {row.user.email ?? "—"}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {row.user.githubUsername ? (
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <GitBranch className="size-3.5" />
                        {row.user.githubUsername}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {formatDate(row.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/*
                        Handing the cohort on, offered only by whoever currently holds it.
                        This is what makes "the owner cannot be removed" livable: without it
                        that rule reads as "whoever set this up runs it forever".
                      */}
                      {data.callerActsAsOwner && !isOwner && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            transfer.mutate({ courseId: data.course.id, userId: row.user.id })
                          }
                        >
                          <KeyRound data-icon="inline-start" />
                          Make owner
                        </Button>
                      )}
                      {mayRemove && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          /*
                            Not offered when it is the last one, and the procedure refuses it
                            regardless — a course with no instructors cannot be authored in or
                            graded, and only a database edit would bring it back.
                          */
                          disabled={busy || onlyOne}
                          onClick={() =>
                            removeInstructor.mutate({
                              courseId: data.course.id,
                              userId: row.user.id,
                            })
                          }
                        >
                          <UserMinus data-icon="inline-start" />
                          {isCaller ? "Leave" : "Remove"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {onlyOne ? (
        <p className="text-xs text-muted-foreground">
          The only instructor on this cohort cannot be removed. Add another one first.
        </p>
      ) : (
        /*
          The rule, said once beside the table rather than discovered by a refusal. The second
          sentence is the one nobody would guess: an owner who leaves without handing the
          cohort on does not leave it ownerless.
        */
        <p className="text-xs text-muted-foreground">
          The owner archives this cohort and decides who else teaches it. Only they can leave it —
          anybody else here can be removed by anyone. If the owner leaves without handing it on, the
          cohort goes to the longest-serving instructor left.
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 text-muted-foreground" />
            Co-teaching link
          </span>
          <span className="text-xs text-muted-foreground">
            Send this to a colleague who should teach this cohort with you. It works only for
            accounts that are already instructors — if they have never signed in here, an admin has
            to send them an instructor invitation from the Staff screen first.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-xs">
            {link}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        {/*
          Said here rather than discovered later. `accept` adds every instructor as a
          collaborator at the moment a student accepts, so somebody added afterwards is not on
          the repositories that already exist — and nothing in the application will tell them
          why a student's code will not open.
        */}
        <p className="text-xs text-muted-foreground">
          An instructor added now is a collaborator on repositories generated from now on. The ones
          students already accepted keep the collaborators they were created with, so they need
          adding on GitHub by hand.
        </p>

        {confirming ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 p-3">
            <span className="text-xs text-amber-700 dark:text-amber-300">
              The current link stops working immediately. Instructors already on this cohort are
              unaffected — anyone you have sent it to and who has not used it yet will need the new
              link.
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  regenerate.mutate({ courseId: data.course.id });
                  setConfirming(false);
                }}
              >
                Replace the link
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setConfirming(true)}
          >
            Replace this link
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Retiring a cohort, or bringing it back.
 *
 * Two clicks to archive and one to unarchive, deliberately asymmetric. Archiving is the one that
 * changes what a whole cohort of students sees, so it says what it will do first; unarchiving
 * only undoes it, and a confirmation on an undo is a confirmation nobody reads.
 *
 * **The owner's, in both directions.** This is the one action a single instructor takes that
 * changes what every student in the cohort sees. Reopening is the same gate because it is the
 * same mutation with a boolean, and the consequence is worth stating on the screen: a
 * co-teacher can read an archived cohort in full and cannot bring it back. A cohort somebody
 * else retired is not theirs to un-retire.
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
  /** Whether this caller owns the cohort, or is an admin, which acts as owner everywhere. */
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
        <h2 className="text-sm font-medium">{archived ? "Reopen" : "Archive"} this cohort</h2>
        <p className="text-xs text-muted-foreground">
          {archived
            ? `${name} is archived. Reopening puts it back on everyone's active course list and lets work be handed in again.`
            : "Archiving takes the cohort off everyone’s active course list and its submissions out of grading triage. Students keep reading their feedback, and nothing new can be handed in. It is reversible."}
        </p>
      </div>

      {!canArchive ? (
        /*
          Said rather than shown as a disabled button. A control that cannot be used is a
          question — is it broken, am I doing it wrong — and the answer here is a fact about
          who to ask.
        */
        <p className="text-xs text-muted-foreground">
          Only {ownerName} can {archived ? "reopen" : "archive"} this cohort, because they own it.
          Everything else on this screen is yours as much as theirs.
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
          Reopen cohort
        </Button>
      ) : confirming ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={setArchived.isPending}
            onClick={() => setArchived.mutate({ courseId, archived: true })}
          >
            Archive — students keep their feedback
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
          Archive cohort
        </Button>
      )}
    </section>
  );
}

/**
 * Deleting a cohort, which is the one thing in this application that cannot be undone.
 *
 * **The counts come first and the confirmation second.** "This cannot be undone" is a
 * generality nobody reads; "24 students, 187 submissions, 143 released grades" is a sentence
 * somebody can weigh, and it is read before the box that unlocks the button rather than beside
 * it. Same shape as removing an assignment, at the grain of a whole term.
 *
 * The short name is what has to be typed, not the course name. A program runs every term under
 * the same name, so typing "Software Engineering Fellowship" would confirm the wrong cohort as
 * readily as the right one — and the short name is the thing that is unique to this one. The
 * procedure is what enforces it; this only decides when to offer the button.
 */
function DeleteCourseCard({ courseId, name }: { courseId: string; name: string }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");

  // Only when asked for. It counts a term's worth of submissions, and this card sits at the
  // bottom of a screen most people open for the co-teaching link.
  const impact = useQuery({
    ...trpc.courses.removalImpact.queryOptions({ courseId }),
    enabled: open,
  });

  const remove = useMutation(
    trpc.courses.remove.mutationOptions(
      settled({
        onSuccess: (result) => {
          /*
            What was destroyed, and what was not. The two leftovers are named rather than
            implied — the repositories are still on GitHub and the files that would not go are
            in a bucket nothing points at any more, so this message is the only record of either.
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

  const ready = typed.trim() !== "" && impact.data?.cohortSlug === typed.trim().toLowerCase();

  if (!open) {
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Delete this cohort</h2>
          <p className="text-xs text-muted-foreground">
            Permanent. {name} and everything in it — assignments, submissions, grades, and the
            feedback that was given — go, and the database&apos;s own backups are the only way back.
            Archiving is the reversible version and this cohort is already archived.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="self-start text-destructive hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <Trash2 data-icon="inline-start" />
          Delete cohort
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
            <Detail label="Students" value={countLabel(impact.data.enrollments, "enrollment")} />
            <Detail
              label="Assignments"
              value={`${impact.data.assignments} in ${countLabel(impact.data.modules, "module")}`}
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
              Named rather than counted silently, because this is the one thing here that
              survives: a student's repository holds their own work and they can reach it on
              GitHub whether or not this application still knows about it.
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
            <label className="text-xs font-medium" htmlFor="confirm-cohort">
              Type <code className="font-mono">{impact.data.cohortSlug}</code> to confirm
            </label>
            <Input
              id="confirm-cohort"
              value={typed}
              autoComplete="off"
              className="font-mono"
              placeholder={impact.data.cohortSlug}
              onChange={(event) => setTyped(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The cohort&apos;s short name, not the course name — every term of this program is
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
          onClick={() => remove.mutate({ courseId, confirmCohortSlug: typed.trim() })}
        >
          {remove.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
          Delete this cohort permanently
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

/** "3 modules", "1 module", "no modules" — a count somebody reads rather than parses. */
function countLabel(count: number, noun: string): string {
  if (count === 0) return `no ${noun}s`;
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** One labelled fact in the impact list, in a column that lines its labels up. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground sm:w-24 sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-muted-foreground">{value}</dd>
    </div>
  );
}
