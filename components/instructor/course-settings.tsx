'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  Archive,
  Check,
  Copy,
  GitBranch,
  RotateCcw,
  ShieldCheck,
  UserMinus,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { studentRepoName } from '@/lib/courses/cohort-slug';
import { formatDate } from '@/lib/status';
import { useTRPC } from '@/trpc/client';
import type { RouterOutputs } from '@/trpc/types';

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

type Data = RouterOutputs['courses']['settings'];

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
            submissions are out of grading triage. Everything stays readable to the people who
            were in it — the gradebook, and every assignment&apos;s own queue — and nothing new
            can be handed in.
          </p>
        </div>
      )}

      <RepositoryNamingCard data={data} />
      <CoTeachingCard data={data} />
      <ArchiveCard courseId={data.course.id} archived={archived} name={data.course.name} />
    </div>
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
    assignmentRepoName: 'swe-1-4-loops',
    githubLogin: 'student',
  });

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Short name</h2>
        <p className="text-xs text-muted-foreground">
          Every repository this cohort generates is named after it, which is what keeps two
          cohorts of the same program apart on GitHub.
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
          The short name, then the assignment&apos;s repository name, then the student&apos;s
          GitHub login.
        </span>
      </div>

      {/*
        Why there is no edit control, said once rather than left as an absence somebody goes
        looking for. The count is the reason it could not be changed even if there were.
      */}
      <p className="text-xs text-muted-foreground">
        {data.acceptedCount > 0 ? (
          <>
            It cannot be changed. {data.acceptedCount}{' '}
            {data.acceptedCount === 1 ? 'repository has' : 'repositories have'} already been
            generated under it, and renaming here would not rename any of them.
          </>
        ) : (
          <>
            It is settled when the course is created and cannot be changed afterwards. Nothing
            has been generated under it yet, so a cohort created by mistake is best created
            again.
          </>
        )}
      </p>

      {data.githubOrgs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {data.githubOrgs.length > 1 ? 'Organizations' : 'Organization'}
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
 * Who else teaches this cohort, and the link that adds somebody.
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
 */
function CoTeachingCard({ data }: { data: Data }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [copied, setCopied] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  // Built in the browser, because the server rendering this has no reliable idea what host the
  // instructor is looking at — a preview deployment and production share the same code.
  const [origin, setOrigin] = React.useState('');
  React.useEffect(() => setOrigin(window.location.origin), []);
  const link = origin
    ? `${origin}/co-teach/${data.course.coTeachToken}`
    : `/co-teach/${data.course.coTeachToken}`;

  const settled = {
    onError: (error: { message: string }) => toast.error(error.message),
  };

  const regenerate = useMutation(
    trpc.courses.regenerateCoTeachToken.mutationOptions({
      ...settled,
      onSuccess: () => {
        toast.success('New co-teaching link. The old one no longer works.');
        router.refresh();
      },
    }),
  );

  const removeInstructor = useMutation(
    trpc.courses.removeInstructor.mutationOptions({
      ...settled,
      onSuccess: (result) => {
        toast.success(`${result.instructorName} no longer teaches this cohort.`);
        router.refresh();
      },
    }),
  );

  const busy = regenerate.isPending || removeInstructor.isPending;
  const onlyOne = data.course.instructors.length <= 1;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Instructors</h2>
        <p className="text-xs text-muted-foreground">
          Everyone here can author assignments in this cohort, read every student&apos;s work,
          and approve grades.
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
                row.user.displayName ?? row.user.githubUsername ?? row.user.email ?? 'Unnamed';
              const isCaller = row.user.id === data.callerId;

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
                          {/* Who set the cohort up. A fact about how it came to exist rather
                              than a rank — the primary instructor is removable like anyone. */}
                          {row.isPrimary && (
                            <Badge variant="secondary" className="font-normal">
                              Created it
                            </Badge>
                          )}
                          {isCaller && (
                            <span className="text-xs font-normal text-muted-foreground">you</span>
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {row.user.email ?? '—'}
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
                      {isCaller ? 'Leave' : 'Remove'}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {onlyOne && (
        <p className="text-xs text-muted-foreground">
          The only instructor on this cohort cannot be removed. Add another one first.
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
            accounts that are already instructors — if they have never signed in here, an admin
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
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        {/*
          Said here rather than discovered later. `accept` adds every instructor as a
          collaborator at the moment a student accepts, so somebody added afterwards is not on
          the repositories that already exist — and nothing in the application will tell them
          why a student's code will not open.
        */}
        <p className="text-xs text-muted-foreground">
          An instructor added now is a collaborator on repositories generated from now on. The
          ones students already accepted keep the collaborators they were created with, so they
          need adding on GitHub by hand.
        </p>

        {confirming ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 p-3">
            <span className="text-xs text-amber-700 dark:text-amber-300">
              The current link stops working immediately. Instructors already on this cohort are
              unaffected — anyone you have sent it to and who has not used it yet will need the
              new link.
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
 */
function ArchiveCard({
  courseId,
  archived,
  name,
}: {
  courseId: string;
  archived: boolean;
  name: string;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);

  const setArchived = useMutation(
    trpc.courses.setArchived.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.archivedAt === null
            ? `${result.name} is active again.`
            : `${result.name} is archived.`,
        );
        setConfirming(false);
        router.refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{archived ? 'Reopen' : 'Archive'} this cohort</h2>
        <p className="text-xs text-muted-foreground">
          {archived
            ? `${name} is archived. Reopening puts it back on everyone's active course list and lets work be handed in again.`
            : 'Archiving takes the cohort off everyone’s active course list and its submissions out of grading triage. Students keep reading their feedback, and nothing new can be handed in. It is reversible.'}
        </p>
      </div>

      {archived ? (
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

function initials(name: string | null): string {
  return (name ?? '?')
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
