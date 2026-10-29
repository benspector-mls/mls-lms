import { slugifyCourse } from "@/lib/courses/course-slug";
import { csvLine, csvPersonName } from "@/lib/csv";
import { displayNameOf } from "@/lib/people";
import { schoolClockOf, schoolDayOf, type SchoolDay } from "@/lib/school-time";

import {
  formatAnswer,
  parseLayout,
  parseSnapshot,
  questionsOf,
  sessionAnswersSchema,
  type CoachingSnapshot,
} from "../coaching";

/**
 * One fellow's coaching history as a spreadsheet: one row per session, one column per field.
 *
 * **Every row has the same columns**, which is what makes the file sortable and filterable, and
 * it takes two decisions to get there. The answer columns are the union of every question any of
 * the fellow's sessions asked, keyed by the question's id in the order first met and headed by
 * its wording in the newest session that asked it — because two sessions run through different
 * forms, or through one form before and after an edit, would otherwise disagree about which
 * column an answer belongs in and what it is called. The snapshot's course columns are the union
 * of every course any session froze, keyed by course id, by the same rule. A session that lacks a
 * question or a course has empty cells under it rather than a shorter row.
 *
 * **A draft is a row too**, with "In progress" in its Status column and nothing under the
 * snapshot, because a draft has not recorded any figures. An empty cell there is the truth; a zero
 * would claim a fellow had attended no mornings.
 *
 * **Oldest first**, where the record lists newest first. A history is read forwards, and both
 * unions take their order from the same pass, so a question or a course that appears in the
 * spring sits to the right of the autumn's.
 *
 * Pure and browser-safe, and built from the payload the record page already fetched — see the top
 * of `lib/gradebook/csv.ts` for why a file assembled from a second query is a file that can
 * disagree with the page it was downloaded from.
 */

export type CoachingCsvPerson = {
  displayName: string | null;
  email: string | null;
  githubUsername: string | null;
  testStudentNumber: number | null;
};

export type CoachingCsvSession = {
  heldOn: SchoolDay;
  createdAt: Date;
  endedAt: Date | null;
  author: {
    displayName: string | null;
    email: string | null;
    githubUsername: string | null;
  } | null;
  temperature: number | null;
  /** The form the session was run through, named as it was that day. */
  templateName: string;
  /** The `layout` column as stored. Read with `parseLayout`; anything else names no questions. */
  layout: unknown;
  /** The `answers` column as stored. Read with `sessionAnswersSchema`; anything else is no answers. */
  answers: unknown;
  /** The `snapshot` column as stored. Read with `parseSnapshot`; anything else is no snapshot. */
  snapshot: unknown;
};

export type CoachingCsvData = {
  person: CoachingCsvPerson;
  program: { name: string };
  sessions: CoachingCsvSession[];
};

type SnapshotCourse = CoachingSnapshot["courses"][number];

/** The verdict in the words the record and the snapshot panel use. */
function verdictWords(verdict: SnapshotCourse["verdict"]): string {
  if (verdict === "complete") return "Complete";
  if (verdict === "incomplete") return "Fell short";
  return "Not finished";
}

/** When a session was completed, as `2026-10-15 14:30` in Brooklyn. Empty for a draft. */
function completedAt(at: Date | null): string | null {
  if (!at) return null;
  return `${schoolDayOf(at)} ${schoolClockOf(at)}`;
}

/** The attendance rate as a whole percent, which reads correctly in a spreadsheet with no formatting. */
function percent(rate: number | null): number | null {
  return rate === null ? null : Math.round(rate * 100);
}

export function coachingCsv(data: CoachingCsvData): string {
  /*
    Oldest first: by the day the conversation was held, and by when the draft was started for two
    sessions on one day, which is the record's own order reversed.
  */
  const sessions = [...data.sessions]
    .sort(
      (a, b) => a.heldOn.localeCompare(b.heldOn) || a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .map((session) => {
      const answers = sessionAnswersSchema.safeParse(session.answers);
      return {
        ...session,
        parsedLayout: parseLayout(session.layout),
        parsedAnswers: answers.success ? answers.data : [],
        answerByPrompt: new Map(
          (answers.success ? answers.data : []).map((answer) => [
            answer.promptId,
            formatAnswer(answer.answer),
          ]),
        ),
        // A draft has no snapshot by the migration's CHECK; parsing it anyway costs nothing.
        parsedSnapshot: parseSnapshot(session.snapshot),
      };
    });

  /*
    Every question any session asked, in the order first met, keyed by id so that a question
    reworded between two sessions is one column rather than two. The heading is the wording in
    the newest session that asked it, which is the wording a reader will recognise today; the loop
    overwrites it on each later session for that reason. A session whose form cannot be read
    still names its questions through the wording stored beside each answer.
  */
  const questionHeadings = new Map<string, string>();
  for (const session of sessions) {
    for (const question of session.parsedLayout ? questionsOf(session.parsedLayout) : []) {
      questionHeadings.set(question.id, question.prompt);
    }
    for (const answer of session.parsedAnswers) {
      if (!questionHeadings.has(answer.promptId)) {
        questionHeadings.set(answer.promptId, answer.prompt);
      }
    }
  }
  const questionIds = [...questionHeadings.keys()];

  /*
    Every course any snapshot froze, by the same rule: keyed by id, in the order first met, under
    its newest name.
  */
  const courseNames = new Map<string, string>();
  for (const session of sessions) {
    for (const course of session.parsedSnapshot?.courses ?? []) {
      courseNames.set(course.courseId, course.name);
    }
  }
  const courseIds = [...courseNames.keys()];

  const lines = [
    csvLine([
      "Fellow",
      "Email",
      "Program",
      "Held on",
      "Form",
      "Status",
      "Completed at",
      "Led by",
      "Temperature",
      ...questionIds.map((id) => questionHeadings.get(id)!),
      "Mornings eligible",
      "Present",
      "Late",
      "Excused",
      "Absent",
      "Unrecorded",
      "Attendance rate (%)",
      ...courseIds.flatMap((id) => {
        const name = courseNames.get(id)!;
        return [
          `${name} · assignments complete`,
          `${name} · assignments possible`,
          `${name} · missing`,
          `${name} · late`,
          `${name} · verdict`,
        ];
      }),
    ]),
  ];

  for (const session of sessions) {
    const snapshot = session.parsedSnapshot;
    const attendance = snapshot?.attendance ?? null;
    const courseById = new Map(
      (snapshot?.courses ?? []).map((course) => [course.courseId, course]),
    );

    lines.push(
      csvLine([
        csvPersonName(data.person, "Unknown fellow"),
        data.person.email,
        data.program.name,
        session.heldOn,
        session.templateName,
        session.endedAt === null ? "In progress" : "Completed",
        completedAt(session.endedAt),
        // The record's own words for a session whose instructor's account has gone.
        session.author ? displayNameOf(session.author, "somebody") : "A former instructor",
        session.temperature,
        ...questionIds.map((id) => session.answerByPrompt.get(id) ?? null),
        attendance?.eligible ?? null,
        attendance?.present ?? null,
        attendance?.late ?? null,
        attendance?.excused ?? null,
        attendance?.absent ?? null,
        attendance?.unrecorded ?? null,
        percent(attendance?.rate ?? null),
        ...courseIds.flatMap((id) => {
          const course = courseById.get(id);
          if (!course) return [null, null, null, null, null];
          return [
            course.completedAssignments.complete,
            course.completedAssignments.possible,
            course.missing,
            course.late,
            verdictWords(course.verdict),
          ];
        }),
      ]),
    );
  }

  // CRLF, as the other two exports write it — see the end of `gradebookCsv`.
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * What the downloaded file is called: the fellow, the program's term, and the day it was taken.
 *
 * The fellow is in it because an instructor preparing reviews downloads one of these per person
 * into the same folder. The date is there because the same fellow's history exported twice in a
 * term is two different files, and the name is the only thing that records which is newer.
 */
export function coachingCsvFilename(params: { fellow: string; term: string; date: Date }): string {
  const stamp = [
    params.date.getFullYear(),
    String(params.date.getMonth() + 1).padStart(2, "0"),
    String(params.date.getDate()).padStart(2, "0"),
  ].join("-");

  // Filtered so that a name `slugifyCourse` cannot transliterate leaves a shorter name rather than
  // a doubled hyphen.
  const parts = [
    "coaching",
    slugifyCourse(params.fellow),
    slugifyCourse(params.term),
    stamp,
  ].filter((part) => part !== "");

  return `${parts.join("-")}.csv`;
}
