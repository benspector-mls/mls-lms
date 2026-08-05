'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import * as React from 'react';
import {
  ArrowRight,
  ClipboardList,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { Gradebook } from '@/components/instructor/gradebook';
import { RemoveAssignmentDialog } from '@/components/instructor/remove-assignment-dialog';
import { EmptyState } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { EnrollmentStatus } from '@/lib/generated/prisma/enums';
import { gradingQueueHref } from '@/lib/links';
import { useTRPC } from '@/trpc/client';
import { formatDate, moduleLabel, moduleOrder } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { RouterOutputs } from '@/trpc/types';

/**
 * One course from the instructor's side: what has been set, who is in it, and where
 * everybody stands.
 */

type Data = RouterOutputs['courses']['gradebook'];
type Assignment = Data['assignments'][number];

export function InstructorCourseDetail({ data }: { data: Data }) {
  const activeStudents = data.enrollments.filter(
    (enrollment) => enrollment.status === 'ACTIVE',
  ).length;

  // The same count the triage screen shows, from the same field, so the two agree.
  const outstanding = data.cells.filter(
    (cell) => cell.bucket !== null && cell.bucket !== 'generating',
  ).length;

  const org = [...new Set(data.assignments.map((assignment) => assignment.githubOrg))];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title={data.course.name}
        description={
          outstanding === 0
            ? data.course.cohortTerm
            : `${data.course.cohortTerm} · ${outstanding} ${
                outstanding === 1 ? 'submission' : 'submissions'
              } waiting on you`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/instructor"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Grading triage
              <ArrowRight data-icon="inline-end" />
            </Link>
            <Link
              href={`/instructor/courses/${data.course.id}/assignments/new`}
              className={cn(buttonVariants({ size: 'sm' }))}
            >
              <Plus data-icon="inline-start" />
              New assignment
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={ClipboardList} label="Assignments" value={data.assignments.length} />
        <StatCard icon={Users} label="Active students" value={activeStudents} />
        <StatCard
          icon={GitBranch}
          label={org.length > 1 ? 'Organizations' : 'Organization'}
          value={org.length > 0 ? org.join(', ') : '—'}
          mono
        />
      </div>

      <Tabs defaultValue="assignments">
        <TabsList>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="roster">Roster</TabsTrigger>
          <TabsTrigger value="gradebook">Gradebook</TabsTrigger>
        </TabsList>

        <TabsContent value="assignments" className="mt-4">
          <AssignmentsTab data={data} />
        </TabsContent>
        <TabsContent value="roster" className="mt-4">
          <RosterTab enrollments={data.enrollments} />
        </TabsContent>
        <TabsContent value="gradebook" className="mt-4">
          <Gradebook data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AssignmentsTab({ data }: { data: Data }) {
  if (data.assignments.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No assignments yet"
        description="Add one from the answer-keys repository — what it holds is what this course can offer."
        action={
          <Link
            href={`/instructor/courses/${data.course.id}/assignments/new`}
            className={cn(buttonVariants())}
          >
            <Plus data-icon="inline-start" />
            New assignment
          </Link>
        }
      />
    );
  }

  const compare = moduleOrder(data.course.moduleStructure);
  const assignments = [...data.assignments].sort((a, b) => {
    const byModule = compare(a.moduleTag, b.moduleTag);
    return byModule !== 0 ? byModule : a.title.localeCompare(b.title);
  });

  const countsFor = (assignment: Assignment) => {
    const cells = data.cells.filter((cell) => cell.assignmentId === assignment.id);
    return {
      graded: cells.filter((cell) => cell.finalScore != null).length,
      // "Handed in": accepting an assignment is not submitting it.
      submitted: cells.filter(
        (cell) => cell.status !== 'NOT_STARTED' && cell.status !== 'ACCEPTED',
      ).length,
      outstanding: cells.filter((cell) => cell.bucket !== null && cell.bucket !== 'generating')
        .length,
    };
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Assignment</TableHead>
            <TableHead className="hidden md:table-cell">Module</TableHead>
            <TableHead className="hidden sm:table-cell">Due</TableHead>
            <TableHead className="text-right">Graded</TableHead>
            <TableHead className="text-right">To grade</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {assignments.map((assignment) => {
            const counts = countsFor(assignment);

            return (
              <TableRow key={assignment.id}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={gradingQueueHref(assignment.id)}
                      className="font-medium hover:underline"
                    >
                      {assignment.title}
                    </Link>
                    {/* A student cannot see this one at all, which is worth saying rather
                        than leaving an instructor to wonder why nobody has submitted. */}
                    {assignment.distributedAt === null && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
                      >
                        Draft
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {assignment.pointValue} pts
                  </p>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant="secondary" className="font-normal">
                    {moduleLabel(assignment.moduleTag)}
                  </Badge>
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {formatDate(assignment.dueAt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className="font-medium">{counts.graded}</span>
                  <span className="text-muted-foreground">/{counts.submitted}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {counts.outstanding > 0 ? (
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
                    >
                      {counts.outstanding}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={gradingQueueHref(assignment.id)}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={`Grade ${assignment.title}`}
                    >
                      <ArrowRight className="size-4" />
                    </Link>
                    <AssignmentActions
                      assignment={assignment}
                      courseId={data.course.id}
                      hasSubmissions={counts.submitted > 0}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Edit, publish, duplicate, and remove, for one assignment.
 *
 * Publishing is the action most often wanted and is offered directly; the rest sit behind the
 * menu. Removing is last and separated, because it is the one action here that destroys
 * student work — the dialog it opens states exactly what would go.
 */
function AssignmentActions({
  assignment,
  courseId,
  hasSubmissions,
}: {
  assignment: Assignment;
  courseId: string;
  hasSubmissions: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = React.useState(false);

  const published = assignment.distributedAt !== null;

  const publish = useMutation(
    trpc.assignments.publish.mutationOptions({
      onSuccess: () => {
        toast.success(`${assignment.title} is now visible to students.`);
        void queryClient.invalidateQueries();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const unpublish = useMutation(
    trpc.assignments.unpublish.mutationOptions({
      onSuccess: () => {
        toast.success(`${assignment.title} is hidden from students. Their work is untouched.`);
        void queryClient.invalidateQueries();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const duplicate = useMutation(
    trpc.assignments.duplicate.mutationOptions({
      onSuccess: (result) => {
        toast.success(`Copied to ${result.assignment.title}. It is not visible to students yet.`);
        void queryClient.invalidateQueries();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const busy = publish.isPending || unpublish.isPending || duplicate.isPending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={busy}
              aria-label={`Actions for ${assignment.title}`}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <MoreHorizontal className="size-4" />
            </button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            render={
              <Link href={`/instructor/courses/${courseId}/assignments/${assignment.id}/edit`}>
                <Pencil data-icon="inline-start" />
                Edit
              </Link>
            }
          />
          {published ? (
            <DropdownMenuItem onClick={() => unpublish.mutate({ assignmentId: assignment.id })}>
              <EyeOff data-icon="inline-start" />
              Hide from students
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => publish.mutate({ assignmentId: assignment.id })}>
              <Eye data-icon="inline-start" />
              Publish
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() =>
              duplicate.mutate({
                assignmentId: assignment.id,
                targetCourseId: courseId,
                // Into the same course, so the name has to differ. Copying to another cohort
                // keeps the name and is what the procedure is really for; that needs a course
                // picker, which waits for course creation to exist.
                assignmentRepoName: `${assignment.title}-copy`,
              })
            }
          >
            <Copy data-icon="inline-start" />
            Duplicate here
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setRemoving(true)}>
            <Trash2 data-icon="inline-start" />
            {hasSubmissions ? 'Remove, with student work' : 'Remove'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RemoveAssignmentDialog
        assignmentId={assignment.id}
        title={assignment.title}
        open={removing}
        onOpenChange={setRemoving}
      />
    </>
  );
}

function RosterTab({ enrollments }: { enrollments: Data['enrollments'] }) {
  if (enrollments.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Nobody is enrolled yet"
        description="Students appear here once they have been invited to the cohort."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead className="hidden sm:table-cell">GitHub</TableHead>
            <TableHead className="text-right">Enrollment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {enrollments.map((enrollment) => {
            // Before an invitation is redeemed there is no profile, only the address it
            // was sent to. That is what identifies the row until they sign in.
            const name = enrollment.student?.displayName ?? enrollment.invitedEmail;
            const email = enrollment.student?.email ?? enrollment.invitedEmail;

            return (
              <TableRow key={enrollment.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                        {enrollment.student ? initials(enrollment.student.displayName) : '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{name}</span>
                      <span className="truncate text-xs text-muted-foreground">{email}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {enrollment.student?.githubUsername ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <GitBranch className="size-3.5" />
                      {enrollment.student.githubUsername}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <EnrollmentBadge status={enrollment.status} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function EnrollmentBadge({ status }: { status: EnrollmentStatus }) {
  const meta: Record<EnrollmentStatus, { label: string; className: string }> = {
    ACTIVE: {
      label: 'Active',
      className: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
    },
    INVITED: {
      label: 'Invited',
      className: 'border-amber-500/40 text-amber-700 dark:text-amber-300',
    },
    REMOVED: { label: 'Removed', className: 'border-border text-muted-foreground' },
  };

  return (
    <Badge variant="outline" className={cn('font-normal', meta[status].className)}>
      {meta[status].label}
    </Badge>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className={cn('truncate font-medium', mono && 'font-mono text-sm')}>{value}</span>
        </div>
      </CardContent>
    </Card>
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
