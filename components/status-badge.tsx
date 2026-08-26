"use client";

// A client component because the tooltips are. `triage-overview.tsx` is a server component and
// renders these badges, which is allowed — a server component may render a client one — but the
// directive has to be here or the Base UI tooltip's hooks run in the wrong place.
import {
  AlertTriangle,
  Code,
  FileText,
  Files,
  Link as LinkIcon,
  NotebookText,
  PlayCircle,
  Upload,
} from "lucide-react";
import type * as React from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { handInMethodsFor, type HandInShape } from "@/lib/assignments/spec";
import type {
  AttendanceStatus,
  GradingDraftStatus,
  ResourceKind,
  SubmissionStatus,
} from "@/lib/generated/prisma/enums";
import { RESOURCE_KIND_LABEL } from "@/lib/resources/spec";
import {
  assignmentKindMeta,
  ATTENDANCE_STATUS_META,
  CONFIDENCE_META,
  DRAFT_STATUS_META,
  flagMeta,
  STUDENT_STATUS_META,
  SUBMISSION_STATUS_META,
  TONE_CLASSES,
  TONE_DOT,
  type StatusMeta,
} from "@/lib/status";
import { cn } from "@/lib/utils";

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
          "inline-flex cursor-help items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
          TONE_CLASSES[meta.tone],
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[meta.tone])}
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
  confidence: "HIGH" | "LOW";
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
  audience = "instructor",
  className,
}: {
  status: SubmissionStatus;
  audience?: "instructor" | "student";
  className?: string;
}) {
  const meta =
    audience === "student" ? STUDENT_STATUS_META[status] : SUBMISSION_STATUS_META[status];
  return <BadgeShell meta={meta} className={className} />;
}

export function AttendanceStatusBadge({
  status,
  className,
}: {
  status: AttendanceStatus;
  className?: string;
}) {
  return <BadgeShell meta={ATTENDANCE_STATUS_META[status]} className={className} />;
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

/**
 * A kind, as the icon that stands for it.
 *
 * **Deliberately not a badge, and outside the tone system every badge above uses.** Those
 * describe where a submission stands and are coloured accordingly; a kind never changes and
 * nothing is waiting on it, so colour would read as a state needing attention. It was a pill
 * carrying an icon and a word, and the word was the problem: on a row it sat between the title
 * and the controls at the end, so a list of fifty rows had fifty labels competing with the fifty
 * titles that are the reason anybody is reading. The icon alone, in front of the title, marks the
 * row without becoming another thing to read down.
 *
 * **The word is still there twice over.** A tooltip gives it to a pointer, and an `sr-only` span
 * gives it to a screen reader — which is what keeps this an abbreviation rather than a loss: an
 * icon nobody can expand is a glyph the reader has to guess at, and the pill it replaced did say
 * the word out loud.
 *
 * The tooltip is hover-only and adds no tab stop, for the reasons `WithExplanation` sets out.
 *
 * One shell for assignments and resources both. The two vocabularies differ and their maps live
 * apart, but a kind marker is one thing on both sides of the application — the same size, the
 * same colour, the same explanation on hover — and two of these would be two of them to keep in
 * step.
 */
function KindIcon({
  icon: Icon,
  label,
  description,
  className,
}: {
  icon: React.ElementType;
  /** The kind's name, read out where the icon cannot be seen. */
  label: string;
  /** What hovering says. The label on its own where there is nothing more to add. */
  description: string;
  className?: string;
}) {
  return (
    <WithExplanation description={description}>
      <span
        className={cn(
          "inline-flex shrink-0 cursor-help items-center text-muted-foreground",
          className,
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
        <span className="sr-only">{label}</span>
      </span>
    </WithExplanation>
  );
}

/**
 * The icon for what a student hands in.
 *
 * A function rather than a `Record` keyed by kind, for the same reason `assignmentKindMeta` is:
 * a self-directed assignment is a link, a file, or either, and three kinds cannot key five
 * answers. `Files` is the either case — two sheets, one behind the other, reading as "more than
 * one form of the same thing" where `Upload` and `LinkIcon` each name exactly one.
 */
function kindIconFor(assignment: HandInShape): React.ElementType {
  switch (assignment.kind) {
    case "REPO":
      return Code;
    case "GOOGLE_DRIVE":
      return FileText;
    case "SELF_DIRECTED": {
      const methods = handInMethodsFor(assignment);
      if (methods.includes("LINK") && methods.includes("FILE")) return Files;
      return methods.includes("FILE") ? Upload : LinkIcon;
    }
  }
}

/**
 * What a student hands in for this assignment.
 *
 * Shown to both audiences, and the same words to each: a student needs to know whether to
 * expect a repository or a document, and there is nothing about the answer they should not be
 * told. That is the exception rather than the rule on this screen — see
 * `SubmissionStatusBadge`, where the two vocabularies genuinely differ.
 *
 * The tooltip names the kind and then says how the work is handed in, because the second half is
 * the part that changes what a student does next — "a pull request from your own copy of a
 * repository" is an instruction, and "Code" on its own is a category.
 */
export function AssignmentKindIcon({
  assignment,
  className,
}: {
  assignment: HandInShape;
  className?: string;
}) {
  const meta = assignmentKindMeta(assignment);

  return (
    <KindIcon
      icon={kindIconFor(assignment)}
      label={meta.label}
      description={`${meta.label} — ${meta.description}`}
      className={className}
    />
  );
}

const RESOURCE_KIND_ICON: Record<ResourceKind, React.ElementType> = {
  LINK: LinkIcon,
  TEXT: NotebookText,
  VIDEO: PlayCircle,
};

/**
 * What kind of resource this is.
 *
 * The words are the ones the authoring form offers, from one map, so a resource is not a "Note"
 * on one screen and "Rich text" on the next.
 *
 * **The tooltip is that word and nothing else**, unlike an assignment's. There is a sentence
 * about each kind in `RESOURCE_KIND_BLURB`, and it is written for whoever is *choosing* a kind on
 * the authoring form rather than for whoever is reading one — a student hovering a note does not
 * need to be told it is stored as markdown. What the pill said was one word, so this says that
 * word.
 */
export function ResourceKindIcon({ kind, className }: { kind: ResourceKind; className?: string }) {
  const label = RESOURCE_KIND_LABEL[kind];

  return (
    <KindIcon
      icon={RESOURCE_KIND_ICON[kind]}
      label={label}
      description={label}
      className={className}
    />
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
          "inline-flex cursor-help items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
          TONE_CLASSES[meta.tone],
          meta.fault && "font-semibold",
          className,
        )}
      >
        {meta.fault ? <AlertTriangle aria-hidden="true" className="size-3" /> : null}
        {meta.label}
      </span>
    </WithExplanation>
  );
}
