/**
 * Reading CodeSignal's own export into attempts this application can store.
 *
 * **Pure, so the whole of "what does this file say" is testable against a real export without a
 * database.** The file is parsed in the browser and the parsed rows are sent to the server, which
 * validates every one of them again — the browser decides what to *show*, never what is true. So
 * this module has to be readable by both, and it reaches for nothing but `lib/csv` and the enum.
 *
 * Three decisions are worth knowing before reading the code, because each was made against a real
 * 274-row export rather than a guess.
 *
 * **The kind is `Proctoring Status`, and only that.** It says `Proctoring verified` or
 * `Not proctored` in words — readable in the file by eye, and impossible to confuse with a number
 * that has to be interpreted. Which column carries the score then follows from the kind: a
 * proctored row fills `Assessment Score` and leaves `Score` and `Max Score` empty, and an
 * unproctored row does the reverse. Every row in a real export agrees, which is what makes an
 * empty column where a value is expected a defect worth reporting rather than a case to handle.
 *
 * **An attempt is a fellow, a kind, and a day.** Not CodeSignal's session id, which is kept only
 * so a row can be traced back: keying on it would mean an import sat a second record beside a
 * score an instructor had already typed in for that day, rather than filling it in.
 *
 * **Nothing but the assessment's name separates a mock GCF from a class exercise**, and that is
 * the one place this cannot be tidy. In a real export the 261 unproctored rows are 61 mock GCFs
 * and 200 `[TIP Practice]` lecture exercises; `Proctoring Status` puts all 261 together, a
 * `Max Score` of 1200 catches all 61 mocks and 46 exercises besides, and the `mockgcf` label is on
 * 36 of the 61 because one mock test was tagged and the other was not. So the name decides what is
 * *offered* — grouped, counted, and ticked by an instructor — and is then discarded. It is never
 * stored and never identifies anything.
 */

import { parseCsvRecords } from "@/lib/csv";

import type { GcfKind } from "../generated/prisma/enums";

/** The columns this reads. Named once so a rename in the export is one edit here. */
const COLUMN = {
  sessionId: "Session ID",
  name: "Assessment Name",
  proctoring: "Proctoring Status",
  email: "Test-Taker Email",
  fullName: "Test-Taker Full Name",
  score: "Score",
  maxScore: "Max Score",
  assessmentScore: "Assessment Score",
  start: "Start Date",
  finish: "Finish Date",
  flagged: "Integrity Flagged",
  resultUrl: "Assessment Result URL",
} as const;

/** The value of `Proctoring Status` on a row that is the real thing. Everything else is a mock. */
const PROCTORED = "proctoring verified";

/**
 * The prefix CodeSignal's mock GCFs are named with today, used to tick them by default.
 *
 * A naming convention rather than a fact about the data, which is exactly why it is a default an
 * instructor overrides rather than a rule compiled in. The day somebody names a mock differently
 * it appears in the list unticked, which is visible; a hardcoded rule would drop it silently.
 */
const MOCK_NAME_PREFIX = "[mock]";

/** One row of the export, read but not yet attached to a student. */
export type GcfImportRow = {
  /** CodeSignal's `Session ID`. Carried for traceability; never the key. */
  externalId: string;
  /** Lowercased, because that is how it is matched. */
  email: string;
  fullName: string;
  kind: GcfKind;
  score: number;
  /** Null on a proctored row, which reports no maximum. */
  scorePossible: number | null;
  /** `YYYY-MM-DD`. A day rather than an instant — see the module note. */
  takenOn: string;
  /**
   * The assessment's name, carried only so the import can group and offer it.
   *
   * **Never stored.** It is not what identifies an attempt, and keeping it would invite a screen
   * to start reading it as though it were.
   */
  assessmentName: string;
  integrityFlagged: boolean;
  resultUrl: string | null;
};

/** A row that could not be read, named well enough for somebody to find it in the file. */
export type GcfImportProblem = {
  /** 1-based, counting the header as row 1, so it matches what a spreadsheet shows. */
  line: number;
  /** Whatever identifies the row to a human — the email, or the session id when there is none. */
  subject: string;
  reason: string;
};

export type GcfImportReading = {
  rows: GcfImportRow[];
  problems: GcfImportProblem[];
  /** How many records the file held, so a caller can say what became of all of them. */
  total: number;
};

/**
 * Every readable row of an export, whatever assessment it was.
 *
 * Filtering happens afterwards, in `assessmentChoices` and the caller's selection, rather than
 * here — because a row dropped at parse time is a row nobody can be told about, and the whole
 * point of the choice screen is that 200 skipped rows are visible rather than silently gone.
 *
 * A bad row becomes a `problem` rather than an exception, so one unreadable line cannot lose the
 * seventy-three around it.
 */
export function parseGcfExport(text: string): GcfImportReading {
  const records = parseCsvRecords(text);
  const rows: GcfImportRow[] = [];
  const problems: GcfImportProblem[] = [];

  records.forEach((record, index) => {
    // +2: the header is line 1, and the first record is line 2.
    const line = index + 2;
    const email = (record[COLUMN.email] ?? "").trim().toLowerCase();
    const externalId = (record[COLUMN.sessionId] ?? "").trim();
    const subject = email || externalId || `row ${line}`;

    const fail = (reason: string) => problems.push({ line, subject, reason });

    if (!email) return fail("no test-taker email, so there is nobody to attach it to");

    const proctoring = (record[COLUMN.proctoring] ?? "").trim().toLowerCase();
    if (!proctoring)
      return fail(`no "${COLUMN.proctoring}", so which assessment it was is unknown`);

    const kind: GcfKind = proctoring === PROCTORED ? "PROCTORED" : "MOCK";

    /*
      The score, from whichever column this kind uses. A proctored row reports its calibrated
      Assessment Score and no maximum; a mock reports raw correctness against a maximum that
      genuinely varies — 300 a task over one, three, four, or six of them.
    */
    const score =
      kind === "PROCTORED"
        ? readNumber(record[COLUMN.assessmentScore])
        : readNumber(record[COLUMN.score]);

    if (score === null) {
      const column = kind === "PROCTORED" ? COLUMN.assessmentScore : COLUMN.score;
      return fail(`a ${kind === "PROCTORED" ? "proctored" : "mock"} row with no "${column}"`);
    }

    let scorePossible: number | null = null;
    if (kind === "MOCK") {
      scorePossible = readNumber(record[COLUMN.maxScore]);
      if (scorePossible === null) return fail(`a mock row with no "${COLUMN.maxScore}"`);
    }

    const takenOn = readDay(record[COLUMN.finish]) ?? readDay(record[COLUMN.start]);
    if (takenOn === null) return fail("no readable finish or start date, so it has no day");

    rows.push({
      externalId,
      email,
      fullName: (record[COLUMN.fullName] ?? "").trim(),
      kind,
      score,
      scorePossible,
      takenOn,
      assessmentName: (record[COLUMN.name] ?? "").trim(),
      integrityFlagged: (record[COLUMN.flagged] ?? "").trim().toLowerCase() === "yes",
      resultUrl: (record[COLUMN.resultUrl] ?? "").trim() || null,
    });
  });

  return { rows, problems, total: records.length };
}

/** One assessment in the file, as the choice screen offers it. */
export type GcfAssessmentChoice = {
  /** The assessment's name, which is the value a caller selects by. */
  name: string;
  kind: GcfKind;
  count: number;
  /** Whether it is ticked when the screen opens. */
  selectedByDefault: boolean;
};

/**
 * What the file holds, grouped so an instructor can say which of it is a GCF.
 *
 * Proctored assessments are ticked and cannot sensibly be anything else — a proctored attempt is
 * the real thing by definition. The unproctored ones are ticked when they carry the `[Mock]`
 * prefix and left unticked otherwise, which in a real export separates 61 mock GCFs from 200
 * class exercises without hiding either.
 *
 * Ordered by kind and then by how many rows each holds, so the largest thing a reader is deciding
 * about is at the top of its group.
 */
export function assessmentChoices(rows: readonly GcfImportRow[]): GcfAssessmentChoice[] {
  const byName = new Map<string, GcfAssessmentChoice>();

  for (const row of rows) {
    const existing = byName.get(row.assessmentName);
    if (existing) {
      existing.count += 1;
      continue;
    }

    byName.set(row.assessmentName, {
      name: row.assessmentName,
      kind: row.kind,
      count: 1,
      selectedByDefault:
        row.kind === "PROCTORED" || row.assessmentName.toLowerCase().startsWith(MOCK_NAME_PREFIX),
    });
  }

  return [...byName.values()].sort(
    (a, b) =>
      Number(b.kind === "PROCTORED") - Number(a.kind === "PROCTORED") ||
      b.count - a.count ||
      a.name.localeCompare(b.name),
  );
}

/** The rows belonging to the assessments a reader ticked. */
export function selectRows(
  rows: readonly GcfImportRow[],
  selectedNames: readonly string[],
): GcfImportRow[] {
  const chosen = new Set(selectedNames);
  return rows.filter((row) => chosen.has(row.assessmentName));
}

/**
 * The key that identifies an attempt: a fellow, a kind, and a day.
 *
 * Exported because the preview counts distinct attempts with it and the commit upserts on the
 * columns it names. One definition, so the count a reader is shown and the rows that get written
 * cannot come apart.
 */
export function attemptKey(row: { email: string; kind: GcfKind; takenOn: string }): string {
  return `${row.email}:${row.kind}:${row.takenOn}`;
}

/**
 * Two rows describing one attempt, collapsed to the last of them.
 *
 * Should never happen — a real export produces 74 distinct triples from its 74 GCF rows — but the
 * database enforces the same uniqueness, so a duplicate would otherwise turn into a failed write
 * halfway through an import rather than something the preview could show.
 */
export function dedupeRows(rows: readonly GcfImportRow[]): {
  rows: GcfImportRow[];
  collapsed: number;
} {
  const byKey = new Map<string, GcfImportRow>();
  for (const row of rows) byKey.set(attemptKey(row), row);

  return { rows: [...byKey.values()], collapsed: rows.length - byKey.size };
}

/** A whole number, or null where the cell is empty or not one. */
function readNumber(value: string | undefined): number | null {
  const text = (value ?? "").trim();
  if (text === "") return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/**
 * The day out of an ISO 8601 instant, as `YYYY-MM-DD`.
 *
 * **Taken off the front of the string rather than through `Date`**, which is the whole reason
 * this is four lines instead of one. `new Date("2026-08-12T15:31:21Z").toISOString()` is correct,
 * but any local-time formatting of it is not: an attempt finished at 00:30 UTC is the previous
 * evening in New York, and a day that moves depending on where the browser is would break the key
 * that identifies the attempt. CodeSignal reports in UTC, so the UTC day is the day.
 */
function readDay(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match ? match[1]! : null;
}
