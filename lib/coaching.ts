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
import type { StatusMeta } from "./status";

export type { DevelopmentMarker };

/**
 * The check-in half of a coaching conversation, in the order it is asked. The temperature check
 * is not here — it is a number with its own column, not a prose answer.
 *
 * Ids are permanent for the reason a competency entry's is: a stored session holds them forever.
 * The prompt text is the current wording, copied onto the row at save time.
 */
export const CHECK_IN_PROMPTS = [
  { id: "on-your-mind", prompt: "What has been on your mind lately?" },
  { id: "excited", prompt: "What are you most excited to work on at the moment?" },
  { id: "challenging", prompt: "Has anything been proving particularly challenging recently?" },
  {
    id: "gap",
    prompt: "Where do you notice a gap between where you are and where you want to be?",
  },
  { id: "stuck", prompt: "When do you feel stuck, unclear, or unsure of how to move forward?" },
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
 * section of its own, after the check-in and before the fellow's goals.
 */
export const ADDITIONAL_NOTES_PROMPT = {
  id: "additional-notes",
  prompt: "Additional notes",
} as const;

/** Every prompt an answer may be stored under: the check-ins, and the notes. */
export const ALL_PROMPTS = [...CHECK_IN_PROMPTS, ADDITIONAL_NOTES_PROMPT] as const;

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

/** The temperature check's bounds, stated once — the zod input, the form, and the migration's CHECK all say 1 to 10. */
export const TEMPERATURE_MIN = 1;
export const TEMPERATURE_MAX = 10;

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
