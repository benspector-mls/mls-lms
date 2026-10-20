import "server-only";

import { z } from "zod";

import { arrivalSentence } from "@/lib/attendance/arrival";
import { recentChecksSentence } from "@/lib/checks/trends";
import { recentWorkSentence } from "@/lib/gradebook/summary";
import { effectiveSection } from "@/lib/grade/delivery";
import type { Tx } from "@/lib/prisma";
import { schoolDayFromColumn, schoolDayOf } from "@/lib/school-time";

import {
  MARKER_META,
  sessionAnswersSchema,
  type SummaryInput,
  type SummaryTheme,
} from "../coaching";
import { attendanceStandingFor, courseFiguresFor, type EnrollmentKey } from "./snapshot";
import type {
  CoachingSummaryInput,
  PromptNote,
  PromptRound,
  PromptSession,
  PromptStanding,
  PromptWriting,
} from "./summary";

/**
 * What one preparation summary reads from a fellow's record, and where the next one starts.
 *
 * **Two kinds of input.** Standing (`figures`) and the fellow's own writing (`writing`) are read
 * whole every time, because they are short and what matters about them is how they are now.
 * Sessions, notes and feedback accumulate across a term, so each is read only from where the
 * previous summary left off — its watermark — and the previous summary stands in for the rest.
 *
 * **An input that is not chosen keeps its watermark where the previous summary left it**, so the
 * material it skipped is read by the next generation that does choose it, rather than passed over.
 *
 * **Caps, and what they cost.** At most `SESSIONS_READ` sessions and `ROUNDS_READ` rounds of
 * feedback, the newest, with the rest counted and named in the prompt. The watermark moves past
 * what was skipped, so a first summary late in the term never reads the earliest rounds; the
 * caption on the record says how many were left out.
 */

/** The newest completed sessions read in one generation. */
export const SESSIONS_READ = 5;

/** The newest rounds of released feedback read in one generation. */
export const ROUNDS_READ = 10;

/**
 * A note counts as edited when it changed more than this long after it was written. `createdAt`
 * and `updatedAt` are both stamped at creation, a few milliseconds apart, so equality cannot be the
 * test; and a note corrected in the minute it was written is not one the model needs told about.
 */
const EDITED_AFTER_MS = 60_000;

const coveredThroughSchema = z.object({
  feedbackAt: z.string().nullable().default(null),
  sessionsAt: z.string().nullable().default(null),
  notesAt: z.string().nullable().default(null),
  roundsRead: z.number().default(0),
  roundsSkipped: z.number().default(0),
  sessionsSkipped: z.number().default(0),
});

/**
 * Where one summary's reading stopped, stored on its row: the newest feedback, session and note it
 * read, as ISO times, and how many rounds and sessions it read and left out. The next generation
 * reads only what is later than each time.
 */
export type CoveredThrough = z.infer<typeof coveredThroughSchema>;

/** The one reader of the `covered_through` column. Nothing read yet, for anything it cannot read. */
export function parseCoveredThrough(json: unknown): CoveredThrough {
  const parsed = coveredThroughSchema.safeParse(json);
  return parsed.success ? parsed.data : coveredThroughSchema.parse({});
}

/** The newest summary before this one, as the next generation reads it. */
export type PreviousSummary = {
  createdAt: Date;
  themes: SummaryTheme[];
  coveredThrough: CoveredThrough;
};

function later(a: string | null, b: Date | null): string | null {
  if (b === null) return a;
  if (a === null || b.getTime() > new Date(a).getTime()) return b.toISOString();
  return a;
}

async function readStanding(db: Tx, enrollment: EnrollmentKey, at: Date): Promise<PromptStanding> {
  const [figures, attendance, gcf, sessions] = await Promise.all([
    courseFiguresFor(db, enrollment, at),
    attendanceStandingFor(db, enrollment, at),
    // The record's own GCF read, without `integrityFlagged`: a flag awaiting review is not a
    // finding, and a model handed one would read it as a statement about the person.
    db.gcfAttempt.findMany({
      where: { studentId: enrollment.studentId },
      orderBy: { takenOn: "desc" },
      select: { kind: true, score: true, scorePossible: true, takenOn: true },
    }),
    // Dates and temperatures only; the answers are the `sessions` input's, read below if chosen.
    db.coachingSession.findMany({
      where: { enrollmentId: enrollment.id, endedAt: { not: null } },
      orderBy: [{ heldOn: "desc" }, { endedAt: "desc" }],
      select: { heldOn: true, temperature: true },
    }),
  ]);

  const { summary, recentAttendance, arrivals } = attendance;

  return {
    attendance: {
      eligible: summary.eligible,
      attended: summary.present + summary.late,
      late: summary.late,
      excused: summary.excused,
      // What the record prints as Absent: an eligible session with no record counts as missed.
      missed: summary.absent + summary.unrecorded,
      rate: summary.rate,
      recentMissed: recentAttendance.missed,
      recentOf: recentAttendance.missedOf,
      recentLate: recentAttendance.late,
      recentLateOf: recentAttendance.lateOf,
    },
    arrivals: arrivalSentence(arrivals),
    // Published courses only: an unpublished one has handed the fellow nothing to be read against.
    courses: figures
      .filter((course) => course.publishedAt !== null)
      .map((course) => ({
        name: course.name,
        verdict: course.verdict,
        complete: course.completedAssignments.complete,
        possible: course.completedAssignments.possible,
        missing: course.missing,
        late: course.late,
        recentWork: recentWorkSentence(course.recent),
        recentChecks: recentChecksSentence(course.checks),
      })),
    gcf: gcf.map((attempt) => ({
      kind: attempt.kind,
      score: attempt.score,
      possible: attempt.scorePossible,
      takenOn: schoolDayFromColumn(attempt.takenOn),
    })),
    sessions: sessions.map((session) => ({
      heldOn: schoolDayFromColumn(session.heldOn),
      temperature: session.temperature,
    })),
  };
}

async function readWriting(db: Tx, enrollment: EnrollmentKey): Promise<PromptWriting> {
  const [goals, topics] = await Promise.all([
    db.goal.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: { createdAt: "asc" },
      select: {
        title: true,
        entryKind: true,
        entryText: true,
        competencyName: true,
        successCriteria: true,
        objectives: true,
        actionPlan: true,
        marker: true,
        createdAt: true,
        updates: {
          orderBy: { createdAt: "asc" },
          select: { body: true, createdAt: true, _count: { select: { attachments: true } } },
        },
        // Withdrawn comments are left out, as they are on both sides' screens.
        comments: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { authorRole: true, body: true, createdAt: true },
        },
      },
    }),
    db.coachingTopic.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: { createdAt: "asc" },
      select: { body: true, createdAt: true },
    }),
  ]);

  return {
    goals: goals.map((goal) => ({
      title: goal.title.trim() === "" ? "(untitled)" : goal.title,
      competency: goal.competencyName,
      entry:
        goal.entryText === null
          ? null
          : goal.entryKind === "PITFALL"
            ? `a pitfall to move away from: ${goal.entryText}`
            : `an indicator to work toward: ${goal.entryText}`,
      successCriteria: goal.successCriteria,
      objectives: goal.objectives,
      actionPlan: goal.actionPlan,
      marker: goal.marker ? MARKER_META[goal.marker].label : null,
      setOn: schoolDayOf(goal.createdAt),
      updates: goal.updates.map((update) => ({
        on: schoolDayOf(update.createdAt),
        body: update.body,
        files: update._count.attachments,
      })),
      comments: goal.comments.map((comment) => ({
        on: schoolDayOf(comment.createdAt),
        by: comment.authorRole === "INSTRUCTOR" ? ("coach" as const) : ("fellow" as const),
        body: comment.body,
      })),
    })),
    topics: topics.map((topic) => ({ on: schoolDayOf(topic.createdAt), body: topic.body })),
  };
}

async function readSessions(db: Tx, enrollment: EnrollmentKey, since: string | null) {
  const sessions = await db.coachingSession.findMany({
    where: {
      enrollmentId: enrollment.id,
      endedAt: since === null ? { not: null } : { gt: new Date(since) },
    },
    orderBy: { endedAt: "desc" },
    select: { heldOn: true, endedAt: true, answers: true },
  });

  const kept = sessions.slice(0, SESSIONS_READ).reverse();
  const items: PromptSession[] = kept.map((session) => {
    const answers = sessionAnswersSchema.safeParse(session.answers);
    return {
      heldOn: schoolDayFromColumn(session.heldOn),
      answers: (answers.success ? answers.data : [])
        .filter((entry) => entry.answer.trim() !== "")
        .map((entry) => ({ prompt: entry.prompt, answer: entry.answer })),
    };
  });

  return {
    items,
    skipped: sessions.length - kept.length,
    // Newest first, so the first row is the newest read.
    newest: sessions[0]?.endedAt ?? null,
  };
}

async function readNotes(db: Tx, enrollment: EnrollmentKey, since: string | null) {
  const notes = await db.instructorNote.findMany({
    where: {
      enrollmentId: enrollment.id,
      ...(since === null ? {} : { updatedAt: { gt: new Date(since) } }),
    },
    orderBy: { updatedAt: "asc" },
    select: { body: true, createdAt: true, updatedAt: true },
  });

  const items: PromptNote[] = notes.map((note) => ({
    on: schoolDayOf(note.createdAt),
    edited: note.updatedAt.getTime() - note.createdAt.getTime() > EDITED_AFTER_MS,
    body: note.body,
  }));

  return { items, newest: notes.at(-1)?.updatedAt ?? null };
}

const releasedSectionSelect = {
  sectionType: true,
  reportMarkdown: true,
  scoreEarned: true,
  scorePossible: true,
  editedReportMarkdown: true,
  editedScoreEarned: true,
} as const;

/**
 * The columns that decide what a fellow was shown for one piece of work: every approved draft, and
 * the hand-graded fallback. `feedbackRounds` in components/student/assignment-panel.tsx is the rule
 * this follows — the drafts when there are any, and `feedbackMarkdown` only when there are none.
 */
const releasedWorkSelect = {
  feedbackMarkdown: true,
  gradedAt: true,
  finalScore: true,
  finalScorePossible: true,
  gradingDrafts: {
    where: { status: "APPROVED" as const },
    orderBy: { approvedAt: "asc" as const },
    select: { approvedAt: true, sections: { select: releasedSectionSelect } },
  },
} as const;

function sumOrNull(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.reduce((total: number, value) => total + value!, 0);
}

async function readFeedback(db: Tx, enrollment: EnrollmentKey, since: string | null) {
  const submissions = await db.submission.findMany({
    where: {
      studentId: enrollment.studentId,
      assignment: { course: { programId: enrollment.programId } },
    },
    select: {
      ...releasedWorkSelect,
      assignment: { select: { title: true, course: { select: { name: true } } } },
      // A team member's row mirrors the one holding the work, and the drafts hang off that one.
      teamSubmission: { select: releasedWorkSelect },
    },
  });

  const after = since === null ? null : new Date(since);
  const isNew = (at: Date | null): at is Date =>
    at !== null && (after === null || at.getTime() > after.getTime());

  const rounds: (PromptRound & { at: Date })[] = [];
  for (const submission of submissions) {
    const held = submission.teamSubmission ?? submission;
    const course = submission.assignment.course.name;
    const assignment = submission.assignment.title;

    if (held.gradingDrafts.length > 0) {
      for (const draft of held.gradingDrafts) {
        if (!isNew(draft.approvedAt)) continue;
        const sections = draft.sections.map(effectiveSection);
        rounds.push({
          at: draft.approvedAt,
          course,
          assignment,
          on: schoolDayOf(draft.approvedAt),
          earned: sumOrNull(sections.map((section) => section.scoreEarned)),
          possible: sumOrNull(sections.map((section) => section.scorePossible)),
          sections: sections.flatMap((section) =>
            section.reportMarkdown && section.reportMarkdown.trim() !== ""
              ? [{ label: section.sectionType, text: section.reportMarkdown }]
              : [],
          ),
        });
      }
    } else if (held.feedbackMarkdown && isNew(held.gradedAt)) {
      rounds.push({
        at: held.gradedAt,
        course,
        assignment,
        on: schoolDayOf(held.gradedAt),
        earned: held.finalScore,
        possible: held.finalScorePossible,
        sections: [{ label: "Feedback", text: held.feedbackMarkdown }],
      });
    }
  }

  rounds.sort((a, b) => a.at.getTime() - b.at.getTime());
  const kept = rounds.slice(-ROUNDS_READ);

  return {
    rounds: kept.map((round) => ({
      course: round.course,
      assignment: round.assignment,
      on: round.on,
      earned: round.earned,
      possible: round.possible,
      sections: round.sections,
    })),
    skipped: rounds.length - kept.length,
    newest: rounds.at(-1)?.at ?? null,
  };
}

/**
 * Reads the parts of the record the coach chose, from where the previous summary stopped, and says
 * where this one stops.
 *
 * `isEmpty` is true when nothing was chosen that has anything in it — no figures can be empty, so
 * it is true only when `figures` was not chosen and every other chosen part came back with nothing.
 */
export async function assembleSummaryInputs(
  db: Tx,
  enrollment: EnrollmentKey,
  params: {
    inputs: readonly SummaryInput[];
    previous: PreviousSummary | null;
    focus: string | null;
    at: Date;
  },
): Promise<{ input: CoachingSummaryInput; coveredThrough: CoveredThrough; isEmpty: boolean }> {
  const chosen = new Set(params.inputs);
  const covered = params.previous?.coveredThrough ?? parseCoveredThrough({});

  const [standing, writing, sessions, notes, feedback] = await Promise.all([
    chosen.has("figures") ? readStanding(db, enrollment, params.at) : null,
    chosen.has("writing") ? readWriting(db, enrollment) : null,
    chosen.has("sessions") ? readSessions(db, enrollment, covered.sessionsAt) : null,
    chosen.has("notes") ? readNotes(db, enrollment, covered.notesAt) : null,
    chosen.has("feedback") ? readFeedback(db, enrollment, covered.feedbackAt) : null,
  ]);

  const coveredThrough: CoveredThrough = {
    feedbackAt: later(covered.feedbackAt, feedback?.newest ?? null),
    sessionsAt: later(covered.sessionsAt, sessions?.newest ?? null),
    notesAt: later(covered.notesAt, notes?.newest ?? null),
    roundsRead: feedback?.rounds.length ?? 0,
    roundsSkipped: feedback?.skipped ?? 0,
    sessionsSkipped: sessions?.skipped ?? 0,
  };

  const writingIsEmpty =
    writing === null || (writing.goals.length === 0 && writing.topics.length === 0);
  const isEmpty =
    standing === null &&
    writingIsEmpty &&
    (sessions === null || sessions.items.length === 0) &&
    (notes === null || notes.items.length === 0) &&
    (feedback === null || feedback.rounds.length === 0);

  const previous = params.previous;

  return {
    input: {
      previous:
        previous === null
          ? null
          : {
              on: schoolDayOf(previous.createdAt),
              themes: previous.themes,
            },
      standing,
      writing,
      sessions: sessions === null ? null : { items: sessions.items, skipped: sessions.skipped },
      notes: notes === null ? null : notes.items,
      feedback: feedback === null ? null : { rounds: feedback.rounds, skipped: feedback.skipped },
      focus: params.focus,
    },
    coveredThrough,
    isEmpty,
  };
}
