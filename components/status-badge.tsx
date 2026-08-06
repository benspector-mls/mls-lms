'use client';

// A client component because the tooltips are. `triage-overview.tsx` is a server component and
// renders these badges, which is allowed — a server component may render a client one — but the
// directive has to be here or the Base UI tooltip's hooks run in the wrong place.
import { AlertTriangle, Code, FileText, Link as LinkIcon, Upload } from 'lucide-react';
import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  AssignmentKind,
  GradingDraftStatus,
  SubmissionStatus,
} from '@/lib/generated/prisma/enums';
import {
  ASSIGNMENT_KIND_META,
  CONFIDENCE_META,
  DRAFT_STATUS_META,
  flagMeta,
  STUDENT_STATUS_META,
  SUBMISSION_STATUS_META,
  TONE_CLASSES,
  TONE_DOT,
  type StatusMeta,
} from '@/lib/status';
import { cn } from '@/lib/utils';

/**
 * Wraps a badge in its own explanation.
 *
 * A real tooltip rather than the native `title` these used to carry. `title` waits about a
 * second and renders as an unstyled system tooltip, which for a vocabulary of eighteen flag
 * codes meant the explanation existed and nobody found it.
 *
 * The trigger is `render`ed as the badge itself rather than wrapped in a button, so the markup
 * stays one element and the badge keeps its own layout.
 *
 * **What this deliberately does not do is add a tab stop.** Base UI's trigger defaults to a
 * `button`, but rendered as a `span` it gains no `tabIndex`, so the tooltip opens on hover and
 * not on focus — the same reach the `title` it replaces had. Making each pill focusable would
 * put four to eight tab stops in front of the controls that actually do something on this
 * screen, which is a worse trade for a keyboard user than the explanation is worth. If the flag
 * vocabulary ever needs to be readable without a pointer, a legend listing all of them is the
 * better answer than eighteen tab stops.
 *
 * No description means no tooltip, rather than an empty one.
 */
function WithExplanation({
  description,
  children,
}: {
  description?: string;
  children: React.ReactElement;
}) {
  if (!description) return children;

  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  );
}

function BadgeShell({ meta, className }: { meta: StatusMeta; className?: string }) {
  return (
    <WithExplanation description={meta.description}>
      <span
        className={cn(
          'inline-flex cursor-help items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
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
    </WithExplanation>
  );
}

/**
 * How sure the model was about a section.
 *
 * Through the same badge as everything else. It used to be assembled at the call site from
 * `TONE_CLASSES` directly, which is how it ended up as the one pill on the review screen with
 * no explanation at all — there was no `description` for it to show.
 */
export function ConfidenceBadge({
  confidence,
  className,
}: {
  confidence: 'HIGH' | 'LOW';
  className?: string;
}) {
  return <BadgeShell meta={CONFIDENCE_META[confidence]} className={className} />;
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
    <WithExplanation description={meta.description}>
      <span
        className={cn(
          'inline-flex cursor-help items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
          TONE_CLASSES[meta.tone],
          meta.fault && 'font-semibold',
          className,
        )}
      >
        {meta.fault ? <AlertTriangle aria-hidden="true" className="size-3" /> : null}
        {meta.label}
      </span>
    </WithExplanation>
  );
}
