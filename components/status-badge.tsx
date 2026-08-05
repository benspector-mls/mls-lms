import { AlertTriangle, Code, FileText, Link as LinkIcon, Upload } from 'lucide-react';
import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import type {
  AssignmentKind,
  GradingDraftStatus,
  SubmissionStatus,
  TestRunStatus,
} from '@/lib/generated/prisma/enums';
import {
  ASSIGNMENT_KIND_META,
  DRAFT_STATUS_META,
  flagMeta,
  STUDENT_STATUS_META,
  SUBMISSION_STATUS_META,
  TEST_RUN_STATUS_META,
  TONE_CLASSES,
  TONE_DOT,
  type StatusMeta,
} from '@/lib/status';
import { cn } from '@/lib/utils';

function BadgeShell({ meta, className }: { meta: StatusMeta; className?: string }) {
  return (
    <span
      title={meta.description}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[meta.tone])}
      />
      {meta.label}
    </span>
  );
}

/**
 * `audience` is not decoration. The instructor vocabulary names states the student must
 * never be shown — a pipeline failure is not the student's problem to read about — so
 * every student-facing use has to pass it explicitly.
 */
export function SubmissionStatusBadge({
  status,
  audience = 'instructor',
  className,
}: {
  status: SubmissionStatus;
  audience?: 'instructor' | 'student';
  className?: string;
}) {
  const meta =
    audience === 'student' ? STUDENT_STATUS_META[status] : SUBMISSION_STATUS_META[status];
  return <BadgeShell meta={meta} className={className} />;
}

export function DraftStatusBadge({
  status,
  className,
}: {
  status: GradingDraftStatus;
  className?: string;
}) {
  return <BadgeShell meta={DRAFT_STATUS_META[status]} className={className} />;
}

export function TestRunStatusBadge({
  status,
  className,
}: {
  status: TestRunStatus;
  className?: string;
}) {
  return <BadgeShell meta={TEST_RUN_STATUS_META[status]} className={className} />;
}

const KIND_ICON: Record<AssignmentKind, React.ElementType> = {
  REPO: Code,
  GOOGLE_DOC: FileText,
  FILE_UPLOAD: Upload,
  EXTERNAL_URL: LinkIcon,
};

/**
 * What a student hands in for this assignment.
 *
 * Deliberately outside the tone system every badge above uses. Those describe where a
 * submission stands and are coloured accordingly; a kind never changes and nothing is waiting
 * on it, so colour here would read as a state needing attention. It gets an icon instead,
 * which is what makes it scannable down a list of fifty rows.
 *
 * Shown to both audiences, and the same words to each: a student needs to know whether to
 * expect a repository or a document, and there is nothing about the answer they should not be
 * told. That is the exception rather than the rule on this screen — see
 * `SubmissionStatusBadge`, where the two vocabularies genuinely differ.
 */
export function AssignmentKindBadge({
  kind,
  className,
}: {
  kind: AssignmentKind;
  className?: string;
}) {
  const meta = ASSIGNMENT_KIND_META[kind];
  const Icon = KIND_ICON[kind];

  return (
    <Badge
      variant="secondary"
      title={meta.description}
      className={cn('font-normal', className)}
    >
      <Icon data-icon="inline-start" />
      {meta.label}
    </Badge>
  );
}

/**
 * One grading flag. Faults carry a warning icon and heavier weight so an instructor does
 * not approve past a missing test run by mistaking it for a neutral note.
 *
 * Instructor screens only — these are internal labels, and a student never sees one.
 */
export function FlagBadge({ code, className }: { code: string; className?: string }) {
  const meta = flagMeta(code);

  return (
    <span
      title={meta.description}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[meta.tone],
        meta.fault && 'font-semibold',
        className,
      )}
    >
      {meta.fault ? <AlertTriangle aria-hidden="true" className="size-3" /> : null}
      {meta.label}
    </span>
  );
}
