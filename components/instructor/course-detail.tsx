'use client';

import Link from 'next/link';
import type * as React from 'react';
import { ArrowRight, ClipboardList, GitBranch, Users } from 'lucide-react';

import { Gradebook } from '@/components/instructor/gradebook';
import { EmptyState } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
          <Link
            href="/instructor"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            Grading triage
            <ArrowRight data-icon="inline-end" />
          </Link>
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
        description="Assignments for this cohort will appear here once they are created."
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
                  <Link
                    href={gradingQueueHref(assignment.id)}
                    className="font-medium hover:underline"
                  >
                    {assignment.title}
                  </Link>
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
                  <Link
                    href={gradingQueueHref(assignment.id)}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={`Grade ${assignment.title}`}
                  >
                    <ArrowRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
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
