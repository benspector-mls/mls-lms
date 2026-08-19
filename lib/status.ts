import type {
  AssignmentKind,
  AttendanceSource,
  AttendanceStatus,
  GradingDraftStatus,
  SubmissionStatus,
} from "@/lib/generated/prisma/enums";

import { SCHOOL_TIME_ZONE } from "@/lib/school-time";
import { isSectionType, SECTION_TYPE_REGISTRY } from "@/lib/section-types";

/**
 * How every status, flag, and number is presented. One place, because the same
 * submission status appears on the student's assignment list, the instructor's triage
 * list, and the gradebook, and those three must never disagree about what it means.
 */

export type StatusTone = "neutral" | "info" | "pending" | "review" | "danger" | "success";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  description: string;
}

/** What an instructor sees for a submission status: the real state of the queue. */
export const SUBMISSION_STATUS_META: Record<SubmissionStatus, StatusMeta> = {
  NOT_STARTED: { label: "Not started", tone: "neutral", description: "No repository created yet." },
  ACCEPTED: {
    label: "Accepted",
    tone: "info",
    description: "Repository created; no pull request opened yet.",
  },
  SUBMITTED: {
    label: "Submitted",
    tone: "pending",
    description: "Pull request open, awaiting grading.",
  },
  DRAFT_READY: {
    label: "Draft ready",
    tone: "review",
    description: "A draft is waiting for your review.",
  },
  // Blue, not green. Green means "met the completion threshold" everywhere else in the
  // interface, and a 9/15 released with a green pill reads as a pass. Grading being finished
  // and the work being complete are different facts, and one colour cannot say both.
  GRADED: { label: "Graded", tone: "info", description: "Approved and sent to the student." },
  RESUBMITTED: {
    label: "Resubmitted",
    tone: "review",
    description: "The student asked for another review.",
  },
  GRADING_FAILED: {
    label: "Grading failed",
    tone: "danger",
    description: "The pipeline errored before a draft was produced.",
  },
  NEEDS_MANUAL_REVIEW: {
    label: "Needs manual review",
    tone: "danger",
    description: "No confident draft could be produced.",
  },
};

/**
 * Attendance, in the same vocabulary as everything else.
 *
 * Here rather than in `lib/attendance/` on purpose: this file is where the application decides
 * what a status is *called*, and a second map living beside the attendance logic is how two
 * screens come to use different words for the same row.
 *
 * **Excused is amber rather than green.** It still counts as a missed session — the note explains
 * the absence rather than undoing it — and a green pill would say the opposite of what the number
 * beneath it says.
 */
export const ATTENDANCE_STATUS_META: Record<AttendanceStatus, StatusMeta> = {
  PRESENT: { label: "Present", tone: "success", description: "Here, within the on-time window." },
  LATE: { label: "Late", tone: "pending", description: "Here, after the on-time window closed." },
  ABSENT: { label: "Absent", tone: "danger", description: "No check-in, and no reason recorded." },
  EXCUSED: {
    label: "Excused",
    tone: "review",
    description: "Missed the session for a reason an instructor accepted. Still counts as missed.",
  },
};

/**
 * How a record came to exist, said in the words a fellow is owed.
 *
 * Words rather than a colour or an icon, for the reason the gradebook writes "Not graded" instead
 * of adding a fourth dot to its legend: this distinction is what a compliance reader is checking,
 * and it has to survive being read quickly.
 */
export function attendanceSourceLabel(source: AttendanceSource, recordedBy: string | null): string {
  if (source === "SELF_CHECK_IN") return "checked in";
  if (source === "INSTRUCTOR") return recordedBy ? `marked by ${recordedBy}` : "marked by staff";
  return "not recorded";
}

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
    label: "Not started",
    tone: "neutral",
    description: "Accept the assignment to create your repository.",
  },
  /*
    Grey, like `NOT_STARTED` above, because to a student the two are the same fact: nothing has
    been handed in and the next move is theirs. Accepting creates a repository, which is
    bookkeeping this application had to do — it is not progress on the work, and a coloured pill
    beside it read as though it were.

    The colour is the whole of the signal here, since the label already says "Accepted". What
    grey buys is the row not standing out on a list where the things that *are* waiting on
    somebody — submitted, awaiting another review, graded — carry a colour each.
  */
  ACCEPTED: {
    label: "Accepted",
    tone: "neutral",
    description: "Work on the draft branch and open a pull request to submit.",
  },
  SUBMITTED: {
    label: "Submitted",
    tone: "pending",
    description: "Your pull request is with your instructor.",
  },
  DRAFT_READY: {
    label: "Submitted",
    tone: "pending",
    description: "Your pull request is with your instructor.",
  },
  NEEDS_MANUAL_REVIEW: {
    label: "Submitted",
    tone: "pending",
    description: "Your pull request is with your instructor.",
  },
  GRADING_FAILED: {
    label: "Submitted",
    tone: "pending",
    description: "Your pull request is with your instructor.",
  },
  RESUBMITTED: {
    label: "Awaiting another review",
    tone: "review",
    description: "You have asked for another look.",
  },
  /*
    Blue, for the reason the instructor's GRADED is. "Your feedback is ready to read" is not
    "you passed" — the score beside it says that, in green or red — and a green pill on work
    below the threshold told the student the opposite of the truth.
  */
  GRADED: { label: "Graded", tone: "info", description: "Your feedback is ready to read." },
};

export const DRAFT_STATUS_META: Record<GradingDraftStatus, StatusMeta> = {
  GENERATING: {
    label: "Generating",
    tone: "pending",
    description: "The grading run is in progress.",
  },
  READY: {
    label: "Ready for review",
    tone: "review",
    description: "A proposal awaiting your approval.",
  },
  /*
    Historical only — nothing writes this. Presented exactly as `READY` because that is what
    these rows always were: a draft awaiting an instructor, with findings recorded in
    `errorDetail`. See the note in `generateReportForSubmission` for why the distinction went.
  */
  NEEDS_MANUAL_REVIEW: {
    label: "Ready for review",
    tone: "review",
    description: "A proposal awaiting your approval.",
  },
  FAILED: { label: "Failed", tone: "danger", description: "The grading pipeline errored." },
  SUPERSEDED: {
    label: "Superseded",
    tone: "neutral",
    description: "A newer draft replaced this one.",
  },
  /*
    Blue rather than green, for the reason `GRADED` is: approving is what releases feedback, not
    a statement that the work passed. Green means the completion threshold was met — see
    `completionMeta` — and a green "Approved" beside a 9/15 said otherwise.
  */
  APPROVED: { label: "Approved", tone: "info", description: "Sent to the student." },
};

/**
 * Flag presentation. `fault` marks the flags an instructor has to consciously decide to
 * approve past, as opposed to the ones that are neutral facts about the run.
 */

export type FlagKind = "writing" | "technical" | "test" | "pipeline";

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
    label: "Mechanical",
    kind: "writing",
    tone: "neutral",
    fault: false,
    description: "Points came off for spelling, grammar, or punctuation.",
  },
  CLARITY: {
    label: "Clarity",
    kind: "writing",
    tone: "neutral",
    fault: false,
    description:
      "Points came off because the writing was vague, contradictory, or more involved than it needed to be.",
  },
  MARKDOWN: {
    label: "Markdown",
    kind: "writing",
    tone: "neutral",
    fault: false,
    description:
      "Points came off because the markdown does not render, or because formatting would have helped and was not used.",
  },
  STRUCTURE: {
    label: "Structure",
    kind: "writing",
    tone: "neutral",
    fault: false,
    description: "Points came off for unclear structure or poor flow.",
  },
  // Technical score.
  INCOMPLETE: {
    label: "Incomplete",
    kind: "technical",
    tone: "neutral",
    fault: false,
    description:
      "Points came off because part of the assignment was not attempted or was left unfinished.",
  },
  UNDERSTANDING: {
    label: "Understanding",
    kind: "technical",
    tone: "neutral",
    fault: false,
    description: "Points came off for a gap, an inaccuracy, or a misunderstanding of the concept.",
  },
  TERMINOLOGY: {
    label: "Terminology",
    kind: "technical",
    tone: "neutral",
    fault: false,
    description: "Points came off for missing or misused terminology.",
  },
  // Test evidence — exactly one of these per section, always.
  TEST_EVIDENCE: {
    label: "Checked against tests",
    kind: "test",
    tone: "success",
    fault: false,
    description:
      "The report's claims about which tests passed were checked against a real run at this commit.",
  },
  NO_TESTS_EXPECTED: {
    label: "No tests by design",
    kind: "test",
    tone: "neutral",
    fault: false,
    description:
      "This section has no test suite, so the score rests on the rubric and a reading of the work. Ordinary for short response and frontend assignments.",
  },
  TEST_RUN_MISSING: {
    label: "Test run missing",
    kind: "test",
    tone: "danger",
    fault: true,
    description:
      "This section expects test results and none exist at this commit, so it was graded without evidence it should have had. Run the tests and generate the report again.",
  },
  TEST_MATCH_MISSING: {
    label: "No matching tests",
    kind: "test",
    tone: "danger",
    fault: true,
    description:
      "The suite ran, but this section's test name pattern matched none of it. Either the pattern is wrong or the tests it names do not exist.",
  },
  // Added by the cross-check rather than the model.
  /*
    No longer written. The confidence pill on every section says this already and always, so
    recording it here as well was the same fact twice — and the cross-check stopped producing
    the finding when the pill got a tooltip of its own.

    The entry stays because this map decodes *stored* flags, and drafts generated before that
    change have this code in their arrays. Without it `flagMeta` would fall back to rendering
    the raw string `LOW_CONFIDENCE` as a badge.
  */
  LOW_CONFIDENCE: {
    label: "Low confidence",
    kind: "pipeline",
    tone: "pending",
    fault: false,
    description: "Recorded by an older grading run. The confidence pill says the same thing.",
  },
  ARITHMETIC_MISMATCH: {
    label: "Arithmetic mismatch",
    kind: "pipeline",
    tone: "danger",
    fault: true,
    description: "The rubric items do not add up to the section score, so one of the two is wrong.",
  },
  REPORT_TEXT_SCORE_MISMATCH: {
    label: "Report/score mismatch",
    kind: "pipeline",
    tone: "danger",
    fault: true,
    description:
      "The score written in the report text is not the score being recorded. The student reads the prose; the gradebook reads the number.",
  },
  INTERNAL_LABEL_IN_REPORT: {
    label: "Internal label in report",
    kind: "pipeline",
    tone: "danger",
    fault: true,
    description:
      "An internal flag code was left in the report text, which the student would read. Remove it before approving.",
  },
  TEST_CLAIM_CONTRADICTION: {
    label: "Test claim contradiction",
    kind: "pipeline",
    tone: "danger",
    fault: true,
    description: "The report says a test passed that the recorded run says failed, or the reverse.",
  },
  UNKNOWN_TEST_CLAIMED: {
    label: "Unknown test claimed",
    kind: "pipeline",
    tone: "danger",
    fault: true,
    description: "The report cites a test that was not in the run.",
  },
  FULL_CREDIT_DESPITE_FAILURES: {
    label: "Full credit despite failures",
    kind: "pipeline",
    tone: "danger",
    fault: true,
    description:
      "Full marks were given on a criterion while tests were failing. Withholding points when tests pass is a legitimate judgment; this is the reverse.",
  },
  PROTECTED_PATHS_CHANGED: {
    label: "Protected paths changed",
    kind: "pipeline",
    tone: "danger",
    fault: true,
    description:
      "The pull request changes test or configuration files. The template's tests were used instead so the score is unaffected — but the change is worth a look.",
  },
  SCORE_OUT_OF_RANGE: {
    label: "Score out of range",
    kind: "pipeline",
    tone: "danger",
    fault: true,
    description: "The section score is below zero or above its maximum.",
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
      kind: "pipeline",
      tone: "neutral",
      fault: false,
      description: code,
    }
  );
}

export const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  review: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  danger: "border-destructive/40 bg-destructive/10 text-destructive dark:text-red-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

/**
 * Whether a draft's own state says anything the submission's does not.
 *
 * `APPROVED` says nothing new: approving is the only thing that sets a submission to `GRADED`,
 * so showing both is the same fact twice in two words. `SUPERSEDED` is history rather than a
 * state to act on — it belongs in the draft history list, which shows every state deliberately,
 * and not beside the submission.
 *
 * Everything else is a fact the submission badge cannot carry: a run in flight, a report waiting
 * to be read, a cross-check finding that holds it back, a run that failed. The grading queue
 * worked this out first and had it written into a comment; this is that rule, in one place, so
 * the queue and the review header cannot come to disagree about it.
 */
export function draftStatusAddsSomething(status: GradingDraftStatus): boolean {
  return status !== "APPROVED" && status !== "SUPERSEDED";
}

/**
 * How a released score reads: met the completion threshold, or did not.
 *
 * Separate from the tone system because it answers a different question. A tone says where
 * something stands in a workflow; this says whether the work passed. They used to share green,
 * which is what made a graded-but-below-threshold assignment look like a pass.
 *
 * Null when there is no verdict to give — nothing graded yet — so a caller cannot accidentally
 * render "Incomplete" for work nobody has looked at.
 */
export function completionMeta(
  isComplete: boolean | null | undefined,
): { label: string; className: string } | null {
  if (isComplete == null) return null;

  return isComplete
    ? { label: "Complete", className: "text-emerald-700 dark:text-emerald-400" }
    : { label: "Incomplete", className: "text-destructive dark:text-red-400" };
}

/**
 * Whether the student has done their part: something has been handed in and nobody is waiting
 * on them.
 *
 * The complement of the three states where the next move is the student's — no submission row
 * at all, `NOT_STARTED`, and `ACCEPTED` — rather than a list of the six that count, so a status
 * added later is treated as handed in until somebody says otherwise. That is the safe direction
 * for the one screen that asks: a deadline list that wrongly omits an assignment is a missed
 * deadline, and one that wrongly keeps an assignment is a row a student can see is wrong.
 *
 * Note what this deliberately does not distinguish. `GRADED` counts, including work that came
 * back below the threshold. Resubmitting is a second attempt at work already handed in, not an
 * outstanding deadline, and putting returned work back on a due-date list would tell a student
 * they had missed something they in fact did.
 */
export function handedIn(status: SubmissionStatus | null | undefined): boolean {
  return status != null && status !== "NOT_STARTED" && status !== "ACCEPTED";
}

/**
 * Whether there is a report the student has not said they read.
 *
 * **`feedbackReviewedAt` is compared against `gradedAt`, never merely checked for null**, and
 * that comparison is the whole reason this is a function rather than a field test at each call
 * site. A submission can be graded more than once: a student reads their first report, revises,
 * asks for another review, and is graded again. Their `feedbackReviewedAt` is already set at
 * that point, so a null check would call the second report read before it had been written, and
 * the one screen that exists to say "there is something new to read" would never mention it.
 *
 * Only `GRADED`. The queue-shaped statuses have no released report to read, and work sitting
 * with an instructor is not unread feedback — it is not feedback yet.
 */
export function feedbackIsUnread(submission: {
  status: SubmissionStatus;
  gradedAt: Date | null;
  feedbackReviewedAt: Date | null;
}): boolean {
  if (submission.status !== "GRADED") return false;
  if (submission.feedbackReviewedAt == null) return true;

  // A grade with no timestamp is older than anything a student could have pressed, so a
  // recorded read stands. Treating it as unread would leave a row nothing could ever clear.
  if (submission.gradedAt == null) return false;

  return submission.feedbackReviewedAt < submission.gradedAt;
}

/**
 * What a student may do about work that is handed in by link or by file, and what to call it.
 *
 * Only these three kinds. A `REPO` assignment's submission signal is the pull request and the
 * webhook owns every column behind it, so there is nothing here for one to decide — see
 * `assertCanHandIn`, which refuses it outright.
 *
 * **The four modes are four different sentences, which is why this is one function rather than a
 * pair of booleans at the call site.** They were two — "is it in the queue" and "has it been
 * graded" — spelled out as a conjunction on the student's screen, and the gap that arrangement
 * left is the reason this exists: work sitting in the queue matched neither, so a student who
 * pasted the wrong link or uploaded the wrong file had no way to correct it and no way to be told
 * why. Their only option was to wait for a grade on work they knew was wrong, and then resubmit.
 *
 * - `submit` — nothing handed in yet. `ACCEPTED` counts, because taking a copy of a Drive template
 *   is receiving the work rather than returning it.
 * - `update` — handed in, waiting, and nobody has looked at it. Replacing it is a correction, not a
 *   new attempt: it overwrites what is there and the submission stays exactly where it is in the
 *   queue.
 * - `resubmit` — graded. Handing in again is a second attempt at work that already has feedback,
 *   which is a different act and reads as one.
 * - `locked` — an instructor has this open and is writing feedback about it. Replacing the work
 *   underneath them would leave a grade describing a file that no longer exists.
 *
 * `instructorHasStarted` is deliberately one boolean rather than the draft's status. Which state a
 * grading draft is in is not a student's business — the queue statuses are collapsed for the same
 * reason in `STUDENT_STATUS_META` — and the only thing this has to answer is whether somebody is
 * looking. It does not lock `submit`, because a draft on work that was never handed in is not
 * something to protect.
 */
export type HandInMode = "submit" | "update" | "resubmit" | "locked";

export function handInMode(
  status: SubmissionStatus | null,
  instructorHasStarted: boolean,
): HandInMode {
  if (status === null || status === "NOT_STARTED" || status === "ACCEPTED") return "submit";
  if (instructorHasStarted) return "locked";
  if (status === "GRADED") return "resubmit";

  // SUBMITTED and RESUBMITTED, plus the three draft-shaped statuses nothing currently writes.
  // Treating an unknown queue state as correctable is the safe direction: the worst case is a
  // student fixing work nobody had started reading.
  return "update";
}

export const TONE_DOT: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground/50",
  info: "bg-sky-500",
  pending: "bg-amber-500",
  review: "bg-violet-500",
  danger: "bg-destructive",
  success: "bg-emerald-500",
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
export const ASSIGNMENT_KIND_META: Record<AssignmentKind, { label: string; description: string }> =
  {
    REPO: {
      label: "Code",
      description: "Handed in as a pull request from your own copy of a repository.",
    },
    GOOGLE_DRIVE: {
      label: "Google Drive",
      description: "Handed in as a link to your own copy of a Doc, Sheet, or Slides deck.",
    },
    FILE_UPLOAD: { label: "File", description: "Handed in as an uploaded file." },
    EXTERNAL_URL: {
      label: "Link",
      description: "Made somewhere else — Canva, Loom, a deployed site — and handed in as a link.",
    },
  };

/**
 * How sure the model was about a section, as a `StatusMeta` so it renders through the same
 * badge as everything else rather than being assembled at the call site.
 *
 * The low description lists the reasons because they are specific and the prompt names them:
 * a file that was needed and absent, code that could not be read, a rubric that does not cover
 * what was submitted, or reference solutions that were expected and missing. **An ordinary
 * borderline judgment is deliberately not one of them** — the prompt says not to use confidence
 * to hedge, and directs a genuine boundary case into `instructorNotes` naming both bands. If
 * that rule ever changes, this text has to change with it.
 */
export const CONFIDENCE_META: Record<"HIGH" | "LOW", StatusMeta> = {
  HIGH: {
    label: "High confidence",
    tone: "success",
    description: "The model reported no reservations about this section’s score.",
  },
  LOW: {
    label: "Low confidence",
    tone: "pending",
    description:
      "The model could not assess something: a file it needed was absent, the code could not " +
      "be read, the rubric does not cover what was submitted, or the reference solutions were " +
      "missing. It does not hold the draft back, but read this section closely.",
  },
};

/**
 * Sections.
 *
 * An assignment can carry more than one gradable section, each scored and reported
 * separately, so both the student's feedback and the instructor's review are per
 * section rather than per assignment.
 */
export function sectionLabel(sectionType: string): string {
  if (isSectionType(sectionType)) return SECTION_TYPE_REGISTRY[sectionType].label;

  // A section type the interface has not been taught about still needs to read as
  // words rather than as a database value.
  const spaced = sectionType.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Dates.
 *
 * Formatted in the school's timezone rather than the reader's. A due date means the
 * deadline in Brooklyn wherever the student happens to be reading from, and fixing the
 * zone also keeps a server rendering in UTC from disagreeing with a browser about which
 * day a late-evening deadline falls on — which React reports as a hydration mismatch.
 *
 * The constant itself moved to `lib/school-time.ts` when attendance made it decide what gets
 * stored rather than only how something is printed. It is imported rather than re-declared so
 * there is one answer to "which day is it here".
 */

export function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A deadline, named by its day. "Thursday, Oct 9 at 11:59 PM".
 *
 * Longer than `formatDateTime` on purpose, and used only where a due date is the whole point of
 * the row. A student planning an evening thinks in weekdays — "it's due Thursday" — and works
 * out which date that is afterwards, so the weekday leads and the date confirms it. On a list
 * where the date is one column among several, `formatDate` is still the right one; this would be
 * a sentence where a date was wanted.
 *
 * No year. Every deadline a student is shown is within the term they are reading it in, and a
 * year on each one is four characters of noise in every case.
 */
export function formatDueDate(d: Date | null | undefined): string {
  if (!d) return "—";

  const day = d.toLocaleDateString("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });

  return `${day} at ${time}`;
}

/**
 * Relative time against a caller-supplied reference point rather than the clock.
 *
 * The caller passes `now` because reading the clock during render is what makes server
 * and client output differ, and because a cached render has no meaningful "now" at all.
 */
export function formatRelative(d: Date | null | undefined, now: Date): string {
  if (!d) return "—";

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
    unit = "min";
  } else if (abs < day) {
    value = Math.round(abs / hour);
    unit = "hr";
  } else {
    value = Math.round(abs / day);
    unit = "day";
  }

  const plural = value === 1 ? "" : "s";
  return past ? `${value} ${unit}${plural} ago` : `in ${value} ${unit}${plural}`;
}

/**
 * The site a submitted link goes to, or null when it is not a link anything should open.
 *
 * **Two jobs, and the second is the reason it returns null rather than a best guess.** It names
 * the host so a reader can see where a link goes before following it, and it is the test for
 * whether a link may be turned into an anchor at all.
 *
 * `http` and `https` only. A URL is not the same thing as a web address: `javascript:alert(1)`
 * parses perfectly and is a script that runs in whoever clicks it, on a page that is already
 * signed in as an instructor with access to every student's work — and `submittedUrl` is a string
 * a student typed, rendered later on somebody else's screen, which is the exact shape of a stored
 * cross-site scripting hole. `data:` and `file:` are refused for the same reason. So this is the
 * one place that decides, and both the schema that accepts a submission and the row that draws
 * one ask it, rather than each carrying its own idea of what counts.
 *
 * `www.` is dropped because it is noise in every case where it appears — nobody checking a link
 * is helped by the distinction between `www.canva.com` and `canva.com`.
 */
export function linkHost(url: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    // Not a URL at all, which is an ordinary mistake: a bare path, or a filename, pasted into a
    // box asking for a link.
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  return parsed.host.replace(/^www\./, "") || null;
}

export function shortSha(sha: string | null | undefined, length = 7): string {
  if (!sha) return "—";
  return sha.slice(0, length);
}

/** Scores. Null means "not graded", which is never the same as zero. */

export function scoreLabel(
  earned: number | null | undefined,
  possible: number | null | undefined,
): string {
  if (earned == null || possible == null) return "—";
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
  if (fraction == null) return "—";
  return `${Math.round(fraction * 100)}%`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;

  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}
