"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { Check, Copy, GitBranch, KeyRound, ShieldCheck, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { displayNameOf, initials } from "@/lib/people";
import { formatDate } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Who instructs this program, who teaches which of its courses, and who owns it.
 *
 * **One link and one grant, where there used to be one per course.** An instructor of a program may
 * act in any of its courses — `assertTeaches` asks for a `ProgramInstructor` row and never for a
 * course one — so being added here is the whole of the permission. That is why the link is the
 * program's: sending four course links to one colleague was four ways of saying the same thing.
 *
 * **Being assigned to a course grants nothing and withholds nothing.** What it decides is whose name
 * is on the course, who is added as a collaborator on the repositories it generates, and which
 * course an instructor's screens open on. Getting it wrong costs a GitHub notification, not access —
 * which is exactly why it is a grid of checkboxes rather than a guarded control.
 *
 * **Everybody here can do the same work; the owner decides two more things.** Every instructor
 * authors, reads every fellow's work, and approves grades. The owner additionally archives the
 * program, says who teaches what, and removes people — the actions with reach beyond the
 * person performing them. Before that distinction existed, anybody who taught could remove the
 * person who set the term up.
 *
 * **It sits on the settings screen rather than one of its own.** Who runs a program is a fact
 * about the program, in the same way its term and its lateness rule are; and these are three
 * cards read when somebody joins or leaves, which is rarer than anything else on that screen. A
 * sidebar item for them was a door onto a section.
 */

type Data = RouterOutputs["programs"]["settings"];

export function ProgramInstructors({ data }: { data: Data }) {
  return (
    <div className="flex flex-col gap-6">
      <InstructorsCard data={data} />
      {data.program.courses.length > 0 && <TeachingGrid data={data} />}
      <InstructorLinkCard data={data} />
    </div>
  );
}

/** Everybody who instructs this program, with the two actions ownership gates. */
function InstructorsCard({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const removeInstructor = useMutation(
    trpc.programs.removeInstructor.mutationOptions(
      settled({
        onSuccess: (result) => {
          /*
            Who owns it now, when that changed. An owner who leaves without handing the program
            on gives it to the longest-serving instructor left — the right default, and not a thing
            anybody would guess, so it is said rather than left to be noticed.
          */
          toast.success(
            result.newOwnerName
              ? `${result.instructorName} no longer instructs this program. ${result.newOwnerName} owns it now.`
              : `${result.instructorName} no longer instructs this program.`,
          );
        },
      }),
    ),
  );

  const transfer = useMutation(
    trpc.programs.transferOwnership.mutationOptions(
      settled({
        onSuccess: (result) => toast.success(`${result.ownerName} owns this program now.`),
      }),
    ),
  );

  const busy = removeInstructor.isPending || transfer.isPending;
  const onlyOne = data.program.instructors.length <= 1;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Instructors</h2>
        <p className="text-xs text-muted-foreground">
          Everyone here can author assignments in every course of this program, read every
          fellow&apos;s work, approve grades, and take attendance.
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
            {data.program.instructors.map((row) => {
              const name = displayNameOf(row.user, "Unnamed");
              const isCaller = row.user.id === data.callerId;
              const isOwner = row.user.id === data.ownerId;

              /*
                The owner can leave, and nobody else can remove them.

                Leaving is a decision about your own work; removing the person who runs a
                program is a decision about theirs. The procedure refuses either way — this
                only decides whether the button is offered, and offering one that always fails is
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
                          {/* Whose program this is. Read from `ownerId`, which the server
                              derived — `isPrimary` is only half the rule, and a row can hold none
                              of it while the program still has an owner. */}
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
                        Handing the program on, offered only by whoever currently holds it.
                        This is what makes "the owner cannot be removed" livable: without it that
                        rule reads as "whoever set this up runs it forever".
                      */}
                      {data.callerActsAsOwner && !isOwner && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            transfer.mutate({
                              programId: data.program.id,
                              userId: row.user.id,
                            })
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
                            regardless — a program with no instructors cannot be authored in
                            or graded, and only a database edit would bring it back.
                          */
                          disabled={busy || onlyOne}
                          onClick={() =>
                            removeInstructor.mutate({
                              programId: data.program.id,
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
          The only instructor on this program cannot be removed. Add another one first.
        </p>
      ) : (
        /*
          The rule, said once beside the table rather than discovered by a refusal. The second
          sentence is the one nobody would guess: an owner who leaves without handing the
          program on does not leave it ownerless.
        */
        <p className="text-xs text-muted-foreground">
          The owner archives this program, says who teaches which course, and removes people. Only
          they can leave it — anybody else here can be removed by anyone. If the owner leaves
          without handing it on, the program goes to the longest-serving instructor left.
        </p>
      )}
    </section>
  );
}

/**
 * Which of this program's courses each instructor's name is on.
 *
 * **A checkbox grid, and this is the one place in the application where that is the right shape.** A
 * cohort and a team set are partitions and use one select per person; teaching is not — three people
 * can teach one course and one person can teach three — so the many-to-many interface is the honest
 * one.
 *
 * **Written per course, on the click.** `setCourseInstructors` takes one course's whole list, so a
 * change to one column is one idempotent write and there is nothing to stage: the grid holds no draft
 * and cannot be left half saved. That is the opposite choice from the cohort placement, and it is
 * right for the opposite reason — this costs a GitHub notification rather than moving somebody's work
 * between piles, so it does not need a review step in front of it.
 *
 * Owner-gated, because deciding who works which course is a decision about other people's work.
 */
function TeachingGrid({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const setCourseInstructors = useMutation(
    trpc.programs.setCourseInstructors.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            result.teaching === 0
              ? `Nobody is named on ${result.name} now.`
              : `${result.teaching} ${result.teaching === 1 ? "instructor" : "instructors"} on ${result.name}.`,
          ),
      }),
    ),
  );

  /*
    Who is on each course now, as the server last answered. Read off the instructor rows rather than
    off the courses, because that is the direction the payload carries it — each `ProgramInstructor`
    knows which courses they teach.
  */
  const teachersOf = new Map<string, Set<string>>(
    data.program.courses.map((course) => [course.id, new Set<string>()]),
  );
  for (const instructor of data.program.instructors) {
    for (const row of instructor.teaches) {
      teachersOf.get(row.courseId)?.add(instructor.user.id);
    }
  }

  function toggle(courseId: string, userId: string, next: boolean) {
    const current = teachersOf.get(courseId) ?? new Set<string>();
    const wanted = new Set(current);
    if (next) wanted.add(userId);
    else wanted.delete(userId);

    setCourseInstructors.mutate({
      programId: data.program.id,
      courseId,
      userIds: [...wanted],
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Who teaches what</h2>
        <p className="text-xs text-muted-foreground">
          Everybody above can already work in every course, so this is not permission. It decides
          whose name fellows see on a course, who is added as a collaborator on the repositories it
          generates, and which course somebody&apos;s screens open on.
        </p>
      </div>

      {!data.callerActsAsOwner ? (
        /*
          Read-only rather than absent. Knowing who is on which course is useful to everybody — it is
          who a fellow will be told to ask — and only the changing of it is the owner's.
        */
        <ReadOnlyTeaching data={data} teachersOf={teachersOf} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Instructor</TableHead>
                {data.program.courses.map((course) => (
                  <TableHead key={course.id} className="text-center">
                    <span className="block max-w-32 truncate">{course.name}</span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.program.instructors.map((instructor) => (
                <TableRow key={instructor.id}>
                  <TableCell className="font-medium">
                    <span className="block max-w-48 truncate">
                      {displayNameOf(instructor.user, "Unnamed")}
                    </span>
                  </TableCell>
                  {data.program.courses.map((course) => {
                    const on = teachersOf.get(course.id)?.has(instructor.user.id) ?? false;
                    return (
                      <TableCell key={course.id} className="text-center">
                        <Checkbox
                          checked={on}
                          disabled={setCourseInstructors.isPending}
                          aria-label={`${displayNameOf(instructor.user, "This instructor")} teaches ${course.name}`}
                          onCheckedChange={(next) =>
                            toggle(course.id, instructor.user.id, next === true)
                          }
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Somebody added to a course now is a collaborator on the repositories it generates from now
        on. The ones fellows have already accepted keep the collaborators they were created with, so
        they need adding on GitHub by hand.
      </p>
    </section>
  );
}

/** The same grid as a sentence per course, for a reader who may not change it. */
function ReadOnlyTeaching({
  data,
  teachersOf,
}: {
  data: Data;
  teachersOf: Map<string, Set<string>>;
}) {
  const nameOf = new Map(
    data.program.instructors.map((row) => [row.user.id, displayNameOf(row.user, "Unnamed")]),
  );

  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
      {data.program.courses.map((course) => {
        const teachers = [...(teachersOf.get(course.id) ?? [])].map((id) => nameOf.get(id) ?? "");
        return (
          <li key={course.id} className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{course.name}</span>
            <span className="text-muted-foreground">
              {teachers.length === 0 ? "nobody named" : teachers.join(", ")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The link that makes somebody an instructor of this program.
 *
 * **The link grants a program, never a role.** Only an account that is already an instructor or
 * an admin can redeem it; a fellow opening it is refused and told an admin has to send them an
 * instructor invitation first. A program-level link that made somebody staff would be a second path
 * to staff access with no admin involved, which is the escalation the Admin screen exists to control.
 *
 * Reusable rather than single use, unlike an instructor invitation, because a program gains
 * instructors one at a time over a year. What bounds it is the role check rather than the token being
 * spent, and replacing it is the control over a link that reached the wrong person.
 */
function InstructorLinkCard({ data }: { data: Data }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [copied, setCopied] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  // Built in the browser, because the server rendering this has no reliable idea what host the
  // instructor is looking at — a preview deployment and production share the same code.
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  const link = origin
    ? `${origin}/teach/${data.program.instructorToken}`
    : `/teach/${data.program.instructorToken}`;

  const regenerate = useMutation(
    trpc.programs.regenerateInstructorToken.mutationOptions(
      settled({
        onSuccess: () => toast.success("New instructor link. The old one no longer works."),
      }),
    ),
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4 text-muted-foreground" />
          Instructor link
        </span>
        <span className="text-xs text-muted-foreground">
          Send this to a colleague who should instruct {data.program.term} with you. It works only
          for accounts that are already instructors — if they have never signed in here, an admin
          has to send them an instructor invitation from the Staff screen first.
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
        What the link actually reaches, said here rather than discovered. It is the widest grant in
        the application short of making somebody an admin: every course of the year, every fellow's
        work in them, and the roster and attendance above them.
      */}
      <p className="text-xs text-muted-foreground">
        Whoever redeems it can author in every course of this program, read every fellow&apos;s
        work, approve grades, and take attendance. It puts their name on no course — that is the
        grid above.
      </p>

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 p-3">
          <span className="text-xs text-amber-700 dark:text-amber-300">
            The current link stops working immediately. Instructors already on this program are
            unaffected — anyone you have sent it to and who has not used it yet will need the new
            link.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={regenerate.isPending}
              onClick={() => {
                regenerate.mutate({ programId: data.program.id });
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
    </section>
  );
}
