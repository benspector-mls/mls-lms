/**
 * The coaching template, the development markers, and the snapshot: what a coaching session asks,
 * how a fellow's standing on a goal is named, and the shape of the record a completed session
 * stores.
 *
 * **Browser-safe and importing nothing but zod and the generated enum**, in the manner of
 * `lib/gcf.ts`: the session form, the fellow's goals page, and the coaching router all read this,
 * and the first two run in the browser.
 *
 * **Everything here is written into rows that outlive it**, which is the design constraint on all
 * three parts. A session stores each prompt's id *and its text as asked*, so editing a prompt
 * here never rewrites what a fellow was actually asked. A goal stores a marker the enum types.
 * And a snapshot carries a version, so the shape can grow without making old rows unreadable —
 * `parseSnapshot` is the one reader, and it answers null rather than throwing, because the caller
 * is a screen rendering a row somebody else wrote.
 */

import { z } from "zod";

import type { DevelopmentMarker } from "./generated/prisma/enums";
import type { StatusMeta, StatusTone } from "./status";

export type { DevelopmentMarker };

/**
 * The check-in half of a coaching conversation, in the order it is asked. The temperature check
 * is not here — it is a number with its own column, not a prose answer.
 *
 * Ids are permanent for the reason a competency entry's is: a stored session holds them forever.
 * The prompt text is the current wording, copied onto the row at save time.
 */
/**
 * What the coach writes before the conversation: what they have noticed, and what they mean to
 * raise. Stored among the answers under its own id, like the additional notes, because it is
 * staff-only prose on a draft session with its label copied in at save — the column already
 * holds exactly that. First in `ALL_PROMPTS`, because it is the first thing the form asks for.
 */
export const PREPARATION_PROMPT = {
  id: "preparation",
  prompt: "Pre-session notes",
} as const;

export const CHECK_IN_PROMPTS = [
  { id: "on-your-mind", prompt: "What has been on your mind lately?" },
  { id: "excited", prompt: "What are you most excited to work on at the moment?" },
  { id: "challenging", prompt: "Has anything been proving particularly challenging recently?" },
  {
    id: "progress",
    prompt:
      "Where have you made progress over the past few weeks / where have you felt most successful?",
  },
  { id: "support", prompt: "What kind of support or accountability would feel helpful?" },
] as const;

export type CheckInPromptId = (typeof CHECK_IN_PROMPTS)[number]["id"];

/**
 * What the `answers` Json column holds: one entry per answered prompt, the prompt text copied in
 * beside its answer. Strict, because a key that passes through silently today is a key some
 * reader depends on tomorrow without anything having decided it.
 */
/**
 * The free-form field that closes the instructor's half of the session form, stored among the
 * answers under its own id rather than in a column of its own.
 *
 * The answers column already holds labelled, staff-only prose on a draft session, autosaved and
 * with the label copied in at save — which is everything this field needs. Kept apart from
 * `CHECK_IN_PROMPTS` so that the check-in list renders unchanged and the form can give this a
 * section of its own, after the check-in and before the goal questions.
 */
export const ADDITIONAL_NOTES_PROMPT = {
  id: "additional-notes",
  prompt: "Additional notes",
} as const;

/**
 * The half of the session spent on the goals the fellow already set: what moved, what shows it,
 * and what changes next time. Staff-only prose like the check-in, stored the same way, and asked
 * after the instructor's notes because the fellow's goals are listed under it on the form.
 */
export const REVISITING_GOALS_PROMPTS = [
  {
    id: "goal-progress",
    prompt:
      "What progress have you made toward the goal you set during your last coaching session?",
  },
  { id: "goal-evidence", prompt: "What evidence, artifact, or example shows that progress?" },
  {
    id: "goal-adjustment",
    prompt: "What helped or got in the way, and what would you adjust moving forward?",
  },
] as const;

/**
 * Every prompt an answer may be stored under, in the order the form asks them: the preparation,
 * the check-ins, the notes, and the goal questions.
 */
export const ALL_PROMPTS = [
  PREPARATION_PROMPT,
  ...CHECK_IN_PROMPTS,
  ADDITIONAL_NOTES_PROMPT,
  ...REVISITING_GOALS_PROMPTS,
] as const;

export const sessionAnswersSchema = z.array(
  z
    .object({
      promptId: z.string().min(1),
      prompt: z.string().min(1),
      answer: z.string(),
    })
    .strict(),
);

export type SessionAnswer = z.infer<typeof sessionAnswersSchema>[number];

/**
 * How long a discussion topic may be: a line or a paragraph the fellow wants to raise, never a
 * document. The migration's CHECK holds the same number.
 */
export const TOPIC_MAX_LENGTH = 2_000;

/**
 * How long one comment under a goal may be — the submission-comment cap, for the same kind of
 * message. The migration's CHECK holds the same number.
 */
export const GOAL_COMMENT_MAX_LENGTH = 5_000;

/** The temperature check's bounds, stated once — the zod input, the form, and the migration's CHECK all say 1 to 10. */
export const TEMPERATURE_MIN = 1;
export const TEMPERATURE_MAX = 10;

/**
 * The colour a temperature is drawn in on the record's session list: red for 1 to 3, amber for 4
 * to 6, green for 7 to 10. An instructor scanning a term of sessions sees a fellow sliding from
 * green into red without reading each number, which is the question the list is opened to answer.
 */
export function temperatureTone(
  temperature: number,
): Extract<StatusTone, "danger" | "pending" | "success"> {
  if (temperature <= 3) return "danger";
  if (temperature <= 6) return "pending";
  return "success";
}

/** The four markers, in ascending order — the order a picker offers them and a reader ranks them. */
export const DEVELOPMENT_MARKERS = [
  "FOUNDATIONAL",
  "DEVELOPING",
  "PROFICIENT",
  "EXCEEDS",
] as const satisfies readonly DevelopmentMarker[];

/**
 * `satisfies` rather than an annotation, so a marker added to the enum and forgotten here is a
 * compile error. The tones climb with the marker — muted, sky, emerald, violet — so a goals list
 * reads as progress without anybody comparing labels.
 */
export const MARKER_META = {
  FOUNDATIONAL: {
    label: "Foundational",
    tone: "neutral",
    description: "Beginning to work on this skill; progress still leans on support.",
  },
  DEVELOPING: {
    label: "Developing",
    tone: "info",
    description: "Practicing the skill deliberately; showing it, but not yet consistently.",
  },
  PROFICIENT: {
    label: "Proficient",
    tone: "success",
    description: "Showing the skill consistently in ordinary work.",
  },
  EXCEEDS: {
    label: "Exceeds",
    tone: "review",
    description: "Showing the skill consistently and modeling it for others.",
  },
} satisfies Record<DevelopmentMarker, StatusMeta>;

/**
 * The snapshot's version, written into every row so the shape can grow. A reader that meets a
 * version it does not know shows the snapshot as absent rather than guessing at its fields.
 */
export const SNAPSHOT_VERSION = 1;

/**
 * What a completed session stores: where the fellow stood at the moment the conversation ended.
 *
 * **A record of what was shown, not a cached verdict.** Lateness and completion are computed when
 * somebody looks everywhere else in this application, and that rule survives here: nothing ever
 * reads a snapshot back as a fellow's current standing. What a snapshot answers is "what were the
 * two people in the room looking at when they agreed these goals" — dated, immutable, never
 * totalled, never compared across fellows, and never grading input.
 *
 * The attendance block mirrors `FellowSummary`'s counting fields; the course block mirrors the
 * per-course figures on the student record. Both are fed by the same functions that draw those
 * screens, in `lib/coaching/snapshot.ts`.
 */
const snapshotSchema = z.object({
  version: z.literal(1),
  /** ISO timestamp of the moment the session was completed. */
  takenAt: z.string(),
  attendance: z.object({
    eligible: z.number(),
    present: z.number(),
    late: z.number(),
    excused: z.number(),
    absent: z.number(),
    unrecorded: z.number(),
    rate: z.number().nullable(),
  }),
  courses: z.array(
    z.object({
      courseId: z.string(),
      name: z.string(),
      completedAssignments: z.object({ complete: z.number(), possible: z.number() }),
      missing: z.number(),
      late: z.number(),
      verdict: z.enum(["complete", "incomplete", "pending"]),
    }),
  ),
});

export type CoachingSnapshot = z.infer<typeof snapshotSchema>;

/** The one reader of the `snapshot` column. Null for anything it cannot read, never a throw. */
export function parseSnapshot(json: unknown): CoachingSnapshot | null {
  const parsed = snapshotSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * The parts of a fellow's record one generation of Themes can read, chosen per generation with a
 * checkbox each. Stored on the row as `inputs`, so a reader of an old summary knows what it saw.
 * See `lib/coaching/summary-inputs.ts` for what each one reads.
 */
export const SUMMARY_INPUTS = ["figures", "writing", "sessions", "notes", "feedback"] as const;
export type SummaryInput = (typeof SUMMARY_INPUTS)[number];

/** How long the coach's focus sentence may be. The migration's CHECK holds the same. */
export const SUMMARY_FOCUS_MAX_LENGTH = 500;

/**
 * Where a theme stands against the previous summary's themes. `resolved` keeps a theme the new
 * material shows has got better for one more summary, so a coach sees what improved as well as
 * what did not; the summary after drops it unless it returns.
 */
export const THEME_STATUSES = ["new", "continuing", "changed", "resolved"] as const;
export type ThemeStatus = (typeof THEME_STATUSES)[number];

/**
 * One theme as the model writes it: where it stands, a title, the one detail behind it, the one
 * question to ask about it, and — shown when the coach opens it — the dated records it rests on
 * and how they add up to it. A summary is a list of these and nothing else.
 */
export const summaryThemeSchema = z.object({
  status: z.enum(THEME_STATUSES),
  title: z.string(),
  callout: z.string(),
  question: z.string(),
  evidence: z.array(z.string()),
  reasoning: z.string(),
});

/**
 * One theme as it is stored: the model's, plus whether a coach has edited it. The next generation
 * is told which themes a coach corrected, and treats those as right.
 */
const storedThemeSchema = summaryThemeSchema.extend({ edited: z.boolean().default(false) });

export type SummaryTheme = z.infer<typeof storedThemeSchema>;

/**
 * The longest each part of a theme may be when a coach edits it. The model is asked for far
 * shorter; these only stop an edit from becoming a document.
 */
export const THEME_FIELD_MAX_LENGTH = {
  title: 200,
  callout: 500,
  question: 500,
  evidenceItem: 1_000,
  evidenceItems: 20,
  reasoning: 2_000,
} as const;

/** A theme as a coach submits it from the edit form. */
export const themeEditSchema = z.object({
  status: z.enum(THEME_STATUSES),
  title: z.string().trim().min(1, "A theme needs a title.").max(THEME_FIELD_MAX_LENGTH.title),
  callout: z.string().trim().max(THEME_FIELD_MAX_LENGTH.callout),
  question: z.string().trim().max(THEME_FIELD_MAX_LENGTH.question),
  evidence: z
    .array(z.string().trim().min(1).max(THEME_FIELD_MAX_LENGTH.evidenceItem))
    .max(THEME_FIELD_MAX_LENGTH.evidenceItems),
  reasoning: z.string().trim().max(THEME_FIELD_MAX_LENGTH.reasoning),
});

/** The one reader of the `themes` column. An empty list for anything it cannot read. */
export function parseSummaryThemes(json: unknown): SummaryTheme[] {
  const parsed = z.array(storedThemeSchema).safeParse(json);
  return parsed.success ? parsed.data : [];
}
