/**
 * The coaching form's layout, the development markers, and the snapshot: what a coaching session
 * asks, how a fellow's standing on a goal is named, and the shape of the record a completed
 * session stores.
 *
 * **Browser-safe and importing nothing but zod and the generated enum**, in the manner of
 * `lib/gcf.ts`: the session form, the form builder, the fellow's goals page, and the coaching
 * routers all read this, and the first three run in the browser.
 *
 * **Everything here is written into rows that outlive it**, which is the design constraint on all
 * three parts. A template's layout is copied onto a session when the session starts, and each
 * answer stores its item's id *and the prompt as asked*, so editing or deleting a template never
 * rewrites what a fellow was actually asked. A goal stores a marker the enum types. And a snapshot
 * carries a version, so the shape can grow without making old rows unreadable — `parseSnapshot`
 * and `parseLayout` are the readers, and each answers null rather than throwing, because the
 * caller is a screen rendering a row somebody else wrote.
 */

import { z } from "zod";

import type { DevelopmentMarker } from "./generated/prisma/enums";
import type { StatusMeta, StatusTone } from "./status";

export type { DevelopmentMarker };

// ---------------------------------------------------------------------------------------------
// The layout: sections of items, written by an admin and copied onto every session
// ---------------------------------------------------------------------------------------------

/**
 * How a question is answered. Each kind decides the control the form draws and the shape of the
 * value stored under the question's id — see `answerFor`.
 */
export const QUESTION_KINDS = [
  "SHORT_TEXT",
  "LONG_TEXT",
  "SCALE",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "YES_NO",
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/**
 * The parts of a fellow's record a form can draw beside its questions. A panel records nothing:
 * it shows the fellow's own writing or figures the record already holds, for the coach to read
 * during the conversation.
 */
export const PANEL_KINDS = ["TOPICS", "GOALS", "GCF", "ATTENDANCE_CALENDAR"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/**
 * The temperature check is its own kind rather than a scale question, because it is bound to the
 * `temperature` column: the record's session list, the Fellows screen's Coaching tab, the CSV
 * export and Themes all read that column. It is always 1 to 10, a form holds at most one, and it
 * is never shared with the fellow.
 */
export const TEMPERATURE_KIND = "TEMPERATURE";

export type ItemKind = QuestionKind | PanelKind | typeof TEMPERATURE_KIND;

/** What the builder calls each kind, and one sentence saying what it is. */
export const ITEM_KIND_META: Record<ItemKind, { label: string; describes: string }> = {
  SHORT_TEXT: { label: "Short text", describes: "One line of text." },
  LONG_TEXT: { label: "Long text", describes: "A paragraph or more." },
  SCALE: { label: "Scale", describes: "A number between two named ends." },
  SINGLE_CHOICE: { label: "Single choice", describes: "One of the options you list." },
  MULTIPLE_CHOICE: { label: "Multiple choice", describes: "Any of the options you list." },
  YES_NO: { label: "Yes or no", describes: "One checkbox." },
  TEMPERATURE: {
    label: "Temperature check",
    describes:
      "Always 1 to 10, coloured by band. The record, the Fellows screen, the CSV and Themes read it.",
  },
  TOPICS: {
    label: "Discussion topics",
    describes: "What the fellow wants to raise, from their Goals page. Drafts only.",
  },
  GOALS: {
    label: "Goals",
    describes: "The fellow's goals, their progress notes, and the conversation under each.",
  },
  GCF: { label: "GCF history", describes: "Every GCF sitting, real or mock." },
  ATTENDANCE_CALENDAR: {
    label: "Attendance calendar",
    describes: "The term's figures and the calendar the fellow sees, square for square.",
  },
};

/** The most points a scale may span, so a question stays a row of squares rather than a slider. */
export const SCALE_MAX_SPAN = 20;

/** How long the Fellows Coaching tab's column heading for a question may be. */
export const OVERVIEW_HEADING_MAX_LENGTH = 30;

/**
 * An item's id: a uuid from the builder, or one of the fixed ids the form carried before it was
 * a template (`preparation`, `on-your-mind`, …), which the migration's converted layout keeps so
 * that every answer stored under them still finds its question.
 */
const itemId = z.string().trim().min(1).max(64);
const caption = z.string().trim().max(500).optional();

/**
 * What every question carries. `shared` is whether the fellow reads the coach's answer once the
 * session is completed; `overview` is whether the answer is a column on the Fellows screen's
 * Coaching tab, under `heading`.
 */
const questionBase = {
  id: itemId,
  prompt: z.string().trim().min(1, "A question needs words in it.").max(500),
  caption,
  shared: z.boolean(),
  overview: z.boolean(),
  heading: z.string().trim().max(OVERVIEW_HEADING_MAX_LENGTH).optional(),
};

const plainQuestion = (kind: "SHORT_TEXT" | "LONG_TEXT" | "YES_NO") =>
  z.object({ kind: z.literal(kind), ...questionBase }).strict();

const scaleQuestion = z
  .object({
    kind: z.literal("SCALE"),
    ...questionBase,
    min: z.number().int(),
    max: z.number().int(),
    lowLabel: z.string().trim().max(60),
    highLabel: z.string().trim().max(60),
  })
  .strict()
  .refine((item) => item.min < item.max, { message: "The low end must be below the high end." })
  .refine((item) => item.max - item.min <= SCALE_MAX_SPAN, {
    message: `A scale spans at most ${SCALE_MAX_SPAN} points.`,
  });

const choiceQuestion = (kind: "SINGLE_CHOICE" | "MULTIPLE_CHOICE") =>
  z
    .object({
      kind: z.literal(kind),
      ...questionBase,
      options: z
        .array(z.string().trim().min(1).max(200))
        .min(1, "List at least one option.")
        .max(20),
    })
    .strict()
    .refine((item) => new Set(item.options).size === item.options.length, {
      message: "Each option must be different.",
    });

const temperatureItem = z
  .object({
    kind: z.literal(TEMPERATURE_KIND),
    id: itemId,
    prompt: z.string().trim().min(1).max(500),
    caption,
  })
  .strict();

const panelItem = z
  .object({
    kind: z.enum(PANEL_KINDS),
    id: itemId,
    heading: z.string().trim().min(1, "A panel needs a heading.").max(200),
    caption,
  })
  .strict();

export const layoutItemSchema = z.discriminatedUnion("kind", [
  plainQuestion("SHORT_TEXT"),
  plainQuestion("LONG_TEXT"),
  plainQuestion("YES_NO"),
  scaleQuestion,
  choiceQuestion("SINGLE_CHOICE"),
  choiceQuestion("MULTIPLE_CHOICE"),
  temperatureItem,
  panelItem,
]);

export type LayoutItem = z.infer<typeof layoutItemSchema>;
export type LayoutQuestion = Extract<LayoutItem, { kind: QuestionKind }>;
export type LayoutPanel = Extract<LayoutItem, { kind: PanelKind }>;
export type LayoutTemperature = Extract<LayoutItem, { kind: typeof TEMPERATURE_KIND }>;

export const layoutSectionSchema = z
  .object({
    id: itemId,
    title: z.string().trim().min(1, "A section needs a title.").max(200),
    caption,
    items: z.array(layoutItemSchema).max(50),
  })
  .strict();

export type LayoutSection = z.infer<typeof layoutSectionSchema>;

/**
 * The whole form, as a template holds it and as a session copies it. Version 1; a reader that
 * meets a version it does not know shows the form as unreadable rather than guessing.
 */
export const coachingLayoutSchema = z
  .object({
    version: z.literal(1),
    sections: z.array(layoutSectionSchema).min(1, "A form needs a section.").max(20),
  })
  .strict()
  .superRefine((layout, ctx) => {
    const ids = new Set<string>();
    let temperatures = 0;
    for (const section of layout.sections) {
      for (const id of [section.id, ...section.items.map((item) => item.id)]) {
        if (ids.has(id)) ctx.addIssue({ code: "custom", message: `The id ${id} is used twice.` });
        ids.add(id);
      }
      for (const item of section.items) {
        if (item.kind === TEMPERATURE_KIND) temperatures += 1;
        if (isQuestion(item) && item.overview && !item.heading) {
          ctx.addIssue({
            code: "custom",
            message: `"${item.prompt}" needs a column heading to appear on the Fellows Coaching tab.`,
          });
        }
      }
    }
    if (temperatures > 1) {
      ctx.addIssue({ code: "custom", message: "A form holds at most one temperature check." });
    }
  });

export type CoachingLayout = z.infer<typeof coachingLayoutSchema>;

export function isQuestion(item: LayoutItem): item is LayoutQuestion {
  return (QUESTION_KINDS as readonly string[]).includes(item.kind);
}

export function isPanel(item: LayoutItem): item is LayoutPanel {
  return (PANEL_KINDS as readonly string[]).includes(item.kind);
}

/** The one reader of either `layout` column. Null for anything it cannot read, never a throw. */
export function parseLayout(json: unknown): CoachingLayout | null {
  const parsed = coachingLayoutSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Every question of a layout, in the order the form asks them. */
export function questionsOf(layout: CoachingLayout): LayoutQuestion[] {
  return layout.sections.flatMap((section) => section.items.filter(isQuestion));
}

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------

/**
 * What one answer holds, by its question's kind: text for the two text kinds, a whole number for
 * a scale, one option or several for the choice kinds, and true or false for yes or no.
 */
export const answerValueSchema = z.union([
  z.string().max(20_000),
  z.number().int(),
  z.boolean(),
  z.array(z.string().max(200)).max(20),
]);

export type AnswerValue = z.infer<typeof answerValueSchema>;

/**
 * What the `answers` Json column holds: one entry per answered question, the prompt text copied in
 * beside its answer. Strict, because a key that passes through silently today is a key some
 * reader depends on tomorrow without anything having decided it.
 */
export const sessionAnswersSchema = z.array(
  z
    .object({
      promptId: z.string().min(1),
      prompt: z.string().min(1),
      answer: answerValueSchema,
    })
    .strict(),
);

export type SessionAnswer = z.infer<typeof sessionAnswersSchema>[number];

/**
 * A value checked against its question: the stored answer, or the sentence that says why it was
 * refused. The server calls this before it stores, and the form calls it to know what it may send.
 */
export function answerFor(
  item: LayoutQuestion,
  value: unknown,
): { ok: true; answer: AnswerValue } | { ok: false; message: string } {
  switch (item.kind) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
      return typeof value === "string" && value.length <= 20_000
        ? { ok: true, answer: value }
        : { ok: false, message: `"${item.prompt}" takes text.` };
    case "SCALE":
      return typeof value === "number" &&
        Number.isInteger(value) &&
        value >= item.min &&
        value <= item.max
        ? { ok: true, answer: value }
        : {
            ok: false,
            message: `"${item.prompt}" takes a number from ${item.min} to ${item.max}.`,
          };
    case "SINGLE_CHOICE":
      return typeof value === "string" && item.options.includes(value)
        ? { ok: true, answer: value }
        : { ok: false, message: `"${item.prompt}" takes one of its options.` };
    case "MULTIPLE_CHOICE":
      return Array.isArray(value) &&
        value.every((option) => typeof option === "string" && item.options.includes(option)) &&
        new Set(value).size === value.length
        ? { ok: true, answer: value as string[] }
        : { ok: false, message: `"${item.prompt}" takes any of its options.` };
    case "YES_NO":
      return typeof value === "boolean"
        ? { ok: true, answer: value }
        : { ok: false, message: `"${item.prompt}" takes yes or no.` };
  }
}

/** An answer as text, however it was stored, for the CSV, the Fellows tab and Themes. */
export function formatAnswer(value: AnswerValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value.join(", ");
}

/** True when an answer says nothing: empty text, or no option chosen. */
export function isBlankAnswer(value: AnswerValue): boolean {
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * One question beside its stored answer, in the words the form asked it with. The prompt is the
 * layout's, which is what the session was started with; the stored copy says the same.
 */
export type AnsweredQuestion = { item: LayoutQuestion; answer: AnswerValue | null };

function answeredQuestionsOf(layout: CoachingLayout, answers: SessionAnswer[]): AnsweredQuestion[] {
  const byId = new Map(answers.map((answer) => [answer.promptId, answer.answer]));
  return questionsOf(layout).map((item) => ({ item, answer: byId.get(item.id) ?? null }));
}

/**
 * What the fellow reads of a completed session's answers: the questions marked shared, in the
 * form's order, each with the coach's answer or null where none was written. Everything the fellow
 * sees of the form passes through here, so one function decides it and one test holds it.
 */
export function sharedAnswersOf(
  layout: CoachingLayout,
  answers: SessionAnswer[],
): AnsweredQuestion[] {
  return answeredQuestionsOf(layout, answers).filter(({ item }) => item.shared);
}

/**
 * The Fellows Coaching tab's cells for one session: the questions marked for it, in the form's
 * order, each with its column heading and its answer as text. A question nobody answered is
 * returned with an empty answer, so the tab still knows the column exists.
 */
export function overviewAnswersOf(
  layout: CoachingLayout,
  answers: SessionAnswer[],
): { id: string; heading: string; prompt: string; answer: string }[] {
  return answeredQuestionsOf(layout, answers)
    .filter(({ item }) => item.overview)
    .map(({ item, answer }) => ({
      id: item.id,
      heading: item.heading ?? item.prompt,
      prompt: item.prompt,
      answer: answer === null ? "" : formatAnswer(answer),
    }));
}

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
