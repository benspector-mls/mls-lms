import type {
  AssignmentKind,
  GradingDraftStatus,
  SubmissionStatus,
  TestRunStatus,
} from '@/lib/generated/prisma/enums';

/**
 * How every status, flag, and number is presented. One place, because the same
 * submission status appears on the student's assignment list, the instructor's triage
 * list, and the gradebook, and those three must never disagree about what it means.
 */

export type StatusTone = 'neutral' | 'info' | 'pending' | 'review' | 'danger' | 'success';

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  description: string;
}

/** What an instructor sees for a submission status: the real state of the queue. */
export const SUBMISSION_STATUS_META: Record<SubmissionStatus, StatusMeta> = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral', description: 'No repository created yet.' },
  ACCEPTED: {
    label: 'Accepted',
    tone: 'info',
    description: 'Repository created; no pull request opened yet.',
  },
  SUBMITTED: {
    label: 'Submitted',
    tone: 'pending',
    description: 'Pull request open, awaiting grading.',
  },
  DRAFT_READY: {
    label: 'Draft ready',
    tone: 'review',
    description: 'A draft is waiting for your review.',
  },
  GRADED: { label: 'Graded', tone: 'success', description: 'Approved and sent to the student.' },
  RESUBMITTED: {
    label: 'Resubmitted',
    tone: 'review',
    description: 'The student asked for another review.',
  },
  GRADING_FAILED: {
    label: 'Grading failed',
    tone: 'danger',
    description: 'The pipeline errored before a draft was produced.',
  },
  NEEDS_MANUAL_REVIEW: {
    label: 'Needs manual review',
    tone: 'danger',
    description: 'No confident draft could be produced.',
  },
};

/**
 * What a student is allowed to see.
 *
 * The three internal queue states all read as "submitted, waiting on your instructor",
 * because they describe this system's problems rather than the student's work: a
 * student shown "grading failed" reasonably concludes they broke something. Never
 * render a raw status name on a student screen.
 */
export const STUDENT_STATUS_META: Record<SubmissionStatus, StatusMeta> = {
  NOT_STARTED: {
    label: 'Not started',
    tone: 'neutral',
    description: 'Accept the assignment to create your repository.',
  },
  ACCEPTED: {
    label: 'Accepted',
    tone: 'info',
    description: 'Work on the draft branch and open a pull request to submit.',
  },
  SUBMITTED: {
    label: 'Submitted',
    tone: 'pending',
    description: 'Your pull request is with your instructor.',
  },
  DRAFT_READY: {
    label: 'Submitted',
    tone: 'pending',
    description: 'Your pull request is with your instructor.',
  },
  NEEDS_MANUAL_REVIEW: {
    label: 'Submitted',
    tone: 'pending',
    description: 'Your pull request is with your instructor.',
  },
  GRADING_FAILED: {
    label: 'Submitted',
    tone: 'pending',
    description: 'Your pull request is with your instructor.',
  },
  RESUBMITTED: {
    label: 'Awaiting another review',
    tone: 'review',
    description: 'You have asked for another look.',
  },
  GRADED: { label: 'Graded', tone: 'success', description: 'Your feedback is ready to read.' },
};

export const DRAFT_STATUS_META: Record<GradingDraftStatus, StatusMeta> = {
  GENERATING: { label: 'Generating', tone: 'pending', description: 'The grading run is in progress.' },
  READY: { label: 'Ready for review', tone: 'review', description: 'A proposal awaiting your approval.' },
  NEEDS_MANUAL_REVIEW: {
    label: 'Needs manual review',
    tone: 'danger',
    description: 'No confident draft could be produced.',
  },
  FAILED: { label: 'Failed', tone: 'danger', description: 'The grading pipeline errored.' },
  SUPERSEDED: { label: 'Superseded', tone: 'neutral', description: 'A newer draft replaced this one.' },
  APPROVED: { label: 'Approved', tone: 'success', description: 'Sent to the student.' },
};

export const TEST_RUN_STATUS_META: Record<TestRunStatus, StatusMeta> = {
  RUNNING: { label: 'Running', tone: 'pending', description: 'The suite is executing.' },
  COMPLETED: { label: 'Completed', tone: 'success', description: 'The suite ran to completion.' },
  TIMED_OUT: { label: 'Timed out', tone: 'danger', description: 'The runner exceeded its time limit.' },
  ERRORED: {
    label: 'Errored',
    tone: 'danger',
    description: 'Infrastructure failure — not a score of zero.',
  },
};

/**
 * Flag presentation. `fault` marks the flags an instructor has to consciously decide to
 * approve past, as opposed to the ones that are neutral facts about the run.
 */

export type FlagKind = 'writing' | 'technical' | 'test' | 'pipeline';

export interface FlagMeta {
  label: string;
  kind: FlagKind;
  tone: StatusTone;
  fault: boolean;
  description: string;
}

export const FLAG_META: Record<string, FlagMeta> = {
  // Writing quality — one per rubric band the student lost points in.
  MECHANICAL: {
    label: 'Mechanical',
    kind: 'writing',
    tone: 'neutral',
    fault: false,
    description: 'Grammar, spelling, or punctuation cost points.',
  },
  CLARITY: {
    label: 'Clarity',
    kind: 'writing',
    tone: 'neutral',
    fault: false,
    description: 'The writing was hard to follow in places.',
  },
  MARKDOWN: {
    label: 'Markdown',
    kind: 'writing',
    tone: 'neutral',
    fault: false,
    description: 'Markdown formatting issues.',
  },
  STRUCTURE: {
    label: 'Structure',
    kind: 'writing',
    tone: 'neutral',
    fault: false,
    description: 'The response was poorly organized.',
  },
  // Technical score.
  INCOMPLETE: {
    label: 'Incomplete',
    kind: 'technical',
    tone: 'neutral',
    fault: false,
    description: 'Part of the work was not attempted or finished.',
  },
  UNDERSTANDING: {
    label: 'Understanding',
    kind: 'technical',
    tone: 'neutral',
    fault: false,
    description: 'A conceptual misunderstanding cost points.',
  },
  TERMINOLOGY: {
    label: 'Terminology',
    kind: 'technical',
    tone: 'neutral',
    fault: false,
    description: 'Imprecise or incorrect terminology.',
  },
  // Test evidence — exactly one of these per section, always.
  TEST_EVIDENCE: {
    label: 'Checked against tests',
    kind: 'test',
    tone: 'success',
    fault: false,
    description: 'Claims were checked against a real test run.',
  },
  NO_TESTS_EXPECTED: {
    label: 'No tests by design',
    kind: 'test',
    tone: 'neutral',
    fault: false,
    description: 'This section has no suite by design; graded on the rubric alone.',
  },
  TEST_RUN_MISSING: {
    label: 'Test run missing',
    kind: 'test',
    tone: 'danger',
    fault: true,
    description: 'Tests were expected but none ran at this commit; graded without them.',
  },
  TEST_MATCH_MISSING: {
    label: 'Test file missing',
    kind: 'test',
    tone: 'danger',
    fault: true,
    description: 'Tests ran but the section pattern matched none; the score was reached without them.',
  },
  // Added by the cross-check rather than the model.
  LOW_CONFIDENCE: {
    label: 'Low confidence',
    kind: 'pipeline',
    tone: 'pending',
    fault: false,
    description: 'The pipeline flagged this section as uncertain.',
  },
  ARITHMETIC_MISMATCH: {
    label: 'Arithmetic mismatch',
    kind: 'pipeline',
    tone: 'danger',
    fault: true,
    description: 'Rubric points do not sum to the section score.',
  },
  REPORT_TEXT_SCORE_MISMATCH: {
    label: 'Report/score mismatch',
    kind: 'pipeline',
    tone: 'danger',
    fault: true,
    description: 'The score written in the report disagrees with the recorded score.',
  },
  INTERNAL_LABEL_IN_REPORT: {
    label: 'Internal label in report',
    kind: 'pipeline',
    tone: 'danger',
    fault: true,
    description: 'An internal label leaked into the student-facing report.',
  },
  TEST_CLAIM_CONTRADICTION: {
    label: 'Test claim contradiction',
    kind: 'pipeline',
    tone: 'danger',
    fault: true,
    description: "The report's test claims contradict the recorded run.",
  },
  UNKNOWN_TEST_CLAIMED: {
    label: 'Unknown test claimed',
    kind: 'pipeline',
    tone: 'danger',
    fault: true,
    description: 'The report cites a test that does not exist.',
  },
  FULL_CREDIT_DESPITE_FAILURES: {
    label: 'Full credit despite failures',
    kind: 'pipeline',
    tone: 'danger',
    fault: true,
    description: 'Full marks despite failing tests.',
  },
  PROTECTED_PATHS_CHANGED: {
    label: 'Protected paths changed',
    kind: 'pipeline',
    tone: 'danger',
    fault: true,
    description: 'The student changed test or configuration files.',
  },
  SCORE_OUT_OF_RANGE: {
    label: 'Score out of range',
    kind: 'pipeline',
    tone: 'danger',
    fault: true,
    description: 'The section score is outside its possible range.',
  },
};

/**
 * An unrecognized code renders as itself rather than disappearing. A flag the interface
 * has not been taught about is still information the instructor should see.
 */
export function flagMeta(code: string): FlagMeta {
  return (
    FLAG_META[code] ?? {
      label: code,
      kind: 'pipeline',
      tone: 'neutral',
      fault: false,
      description: code,
    }
  );
}

export const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  review: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  danger: 'border-destructive/40 bg-destructive/10 text-destructive dark:text-red-300',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

export const TONE_DOT: Record<StatusTone, string> = {
  neutral: 'bg-muted-foreground/50',
  info: 'bg-sky-500',
  pending: 'bg-amber-500',
  review: 'bg-violet-500',
  danger: 'bg-destructive',
  success: 'bg-emerald-500',
};

/**
 * What a student hands in, in one word.
 *
 * No tone, because a kind is not a state: it does not change, nothing is waiting on it, and
 * colouring it would make a permanent property of an assignment look like something that
 * needed attention. Both audiences read the same words — unlike a submission status, there is
 * nothing here a student should not be told.
 *
 * The descriptions are what the badge carries as a tooltip, so they say how the work is handed
 * in rather than restating the label.
 */
export const ASSIGNMENT_KIND_META: Record<AssignmentKind, { label: string; description: string }> = {
  REPO: {
    label: 'Code',
    description: 'Handed in as a pull request from your own copy of a repository.',
  },
  GOOGLE_DOC: {
    label: 'Google Doc',
    description: 'Handed in as a link to your own copy of a document.',
  },
  FILE_UPLOAD: { label: 'File', description: 'Handed in as an uploaded file.' },
  EXTERNAL_URL: {
    label: 'Link',
    description: 'Made somewhere else — Canva, Loom, a deployed site — and handed in as a link.',
  },
};

export const CONFIDENCE_META: Record<'HIGH' | 'LOW', { label: string; tone: StatusTone }> = {
  HIGH: { label: 'High confidence', tone: 'success' },
  LOW: { label: 'Low confidence', tone: 'pending' },
};

/**
 * Sections.
 *
 * An assignment can carry more than one gradable section, each scored and reported
 * separately, so both the student's feedback and the instructor's review are per
 * section rather than per assignment.
 */
const SECTION_LABELS: Record<string, string> = {
  short_response: 'Short response',
  coding_algorithm: 'Algorithm fluency',
  coding_sql: 'SQL fluency',
  coding_frontend: 'Frontend',
};

export function sectionLabel(sectionType: string): string {
  const known = SECTION_LABELS[sectionType];
  if (known) return known;

  // A section type the interface has not been taught about still needs to read as
  // words rather than as a database value.
  const spaced = sectionType.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Dates.
 *
 * Formatted in the school's timezone rather than the reader's. A due date means the
 * deadline in Brooklyn wherever the student happens to be reading from, and pinning the
 * zone also keeps a server rendering in UTC from disagreeing with a browser about which
 * day a late-evening deadline falls on — which React reports as a hydration mismatch.
 */
const SCHOOL_TIME_ZONE = 'America/New_York';

export function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-US', {
    timeZone: SCHOOL_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    timeZone: SCHOOL_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Relative time against a caller-supplied reference point rather than the clock.
 *
 * The caller passes `now` because reading the clock during render is what makes server
 * and client output differ, and because a cached render has no meaningful "now" at all.
 */
export function formatRelative(d: Date | null | undefined, now: Date): string {
  if (!d) return '—';

  const diffMs = now.getTime() - d.getTime();
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let value: number;
  let unit: string;
  if (abs < hour) {
    value = Math.max(1, Math.round(abs / minute));
    unit = 'min';
  } else if (abs < day) {
    value = Math.round(abs / hour);
    unit = 'hr';
  } else {
    value = Math.round(abs / day);
    unit = 'day';
  }

  const plural = value === 1 ? '' : 's';
  return past ? `${value} ${unit}${plural} ago` : `in ${value} ${unit}${plural}`;
}

export function shortSha(sha: string | null | undefined, length = 7): string {
  if (!sha) return '—';
  return sha.slice(0, length);
}

/** Scores. Null means "not graded", which is never the same as zero. */

export function scoreLabel(earned: number | null | undefined, possible: number | null | undefined): string {
  if (earned == null || possible == null) return '—';
  return `${earned}/${possible}`;
}

export function scorePercent(
  earned: number | null | undefined,
  possible: number | null | undefined,
): number | null {
  if (earned == null || possible == null || possible === 0) return null;
  return earned / possible;
}

export function formatPercent(fraction: number | null): string {
  if (fraction == null) return '—';
  return `${Math.round(fraction * 100)}%`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;

  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}
