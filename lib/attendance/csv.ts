import { slugifyCourse } from "@/lib/courses/course-slug";
import { csvLine, csvPersonName } from "@/lib/csv";
import type { AttendanceSource, AttendanceStatus } from "@/lib/generated/prisma/enums";
import { SCHOOL_TIME_ZONE, type SchoolDay } from "@/lib/school-time";

/**
 * Attendance as a spreadsheet, for the people who have to defend it.
 *
 * **Long format — one row per fellow per session — and not the grid that is on screen.** The
 * gradebook exports wide because a gradebook *is* a grid: a student against an assignment, read
 * across. This file is money. It gets summed per person, pivoted by pay period, filtered to one
 * month, and eventually mapped onto Salesforce records, and long format does all four while wide
 * format does none of them. It also means no date-range picker is needed in the interface: the
 * reader filters the Date column.
 *
 * **The `Recorded` column is the whole compliance argument.** A stipend day defended on a fellow's
 * own check-in is a different claim from one defended on a staff correction, and a third case —
 * nobody recorded anything and the session ended — is different again. Those three are why
 * `AttendanceSource` exists, and flattening them here would throw away the distinction the table
 * was shaped to keep.
 *
 * **Every time in the file is Brooklyn time.** Mixing zones inside one export is the classic error:
 * the Date column is a school day, so a check-in timestamp in UTC beside it would put a 9:04 arrival
 * on the previous evening for anybody who read the two together.
 *
 * Pure and browser-safe, and built from the payload already on screen — see the top of
 * `lib/gradebook/csv.ts` for why a file assembled from its own second query is a file that can
 * disagree with the page it was downloaded from, in a way nobody holding it can detect.
 */

export type AttendanceCsvPerson = {
  displayName: string | null;
  email: string | null;
  githubUsername: string | null;
  testStudentNumber: number | null;
};

export type AttendanceCsvSession = {
  id: string;
  day: SchoolDay;
  /** Still open. Reported, but with no status, because nothing about it is settled yet. */
  open: boolean;
};

export type AttendanceCsvFellow = {
  enrollmentId: string;
  person: AttendanceCsvPerson;
  /** ACTIVE or REMOVED, carried as a column for the reason the gradebook carries it. */
  enrollment: string;
  /** The first school day this fellow could have attended. */
  enrolledFrom: SchoolDay;
};

export type AttendanceCsvRecord = {
  enrollmentId: string;
  sessionId: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  checkedInAt: Date | null;
  note: string | null;
};

export type AttendanceCsvData = {
  sessions: AttendanceCsvSession[];
  fellows: AttendanceCsvFellow[];
  records: AttendanceCsvRecord[];
};

/** What the `Recorded` column says, which is `AttendanceSource` in words a reader can use. */
function recordedBy(source: AttendanceSource | null): string {
  if (source === "SELF_CHECK_IN") return "self";
  if (source === "INSTRUCTOR") return "instructor";
  // Covers both the finalized row and the case where no row exists at all. Both mean the same
  // thing to somebody auditing the file: nobody put a mark against this person for this day.
  return "not recorded";
}

/** The clock time a fellow checked in, in the school's zone. Empty when they did not. */
function checkedInTime(at: Date | null): string | null {
  if (!at) return null;
  return at.toLocaleTimeString("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function attendanceCsv(data: AttendanceCsvData): string {
  const byPair = new Map(
    data.records.map((record) => [`${record.enrollmentId}:${record.sessionId}`, record]),
  );

  const lines = [
    csvLine([
      "Fellow",
      "Email",
      "GitHub username",
      "Enrollment",
      "Date",
      "Weekday",
      "Status",
      "Recorded",
      "Checked in at",
      "Note",
    ]),
  ];

  /*
    Fellow first, then date. The other order groups the file by day, which is what the screen
    already does well; grouped by person it sums per person with one drag, which is the operation
    somebody actually performs on this file.
  */
  for (const fellow of data.fellows) {
    for (const session of data.sessions) {
      // A fellow who was not yet enrolled has no row for that day at all, rather than a row saying
      // absent. An empty cell can be misread; a row asserting they missed a session they were not
      // admitted to is simply wrong, and it would be wrong in a number somebody is paid against.
      if (session.day < fellow.enrolledFrom) continue;

      const record = byPair.get(`${fellow.enrollmentId}:${session.id}`) ?? null;

      lines.push(
        csvLine([
          csvPersonName(fellow.person, "Unknown fellow"),
          fellow.person.email,
          fellow.person.githubUsername,
          fellow.enrollment,
          session.day,
          weekdayOf(session.day),
          // An open session has settled nothing. Saying "absent" for a morning still in progress
          // would be a claim the application cannot support, so the cell says what is true.
          session.open ? "In progress" : (record?.status ?? "ABSENT"),
          session.open ? "" : recordedBy(record?.source ?? null),
          checkedInTime(record?.checkedInAt ?? null),
          record?.note ?? null,
        ]),
      );
    }
  }

  return lines.join("\r\n");
}

/** "Friday", from the school day. UTC because the day string is already civil — see `school-time`. */
function weekdayOf(day: SchoolDay): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
  });
}

/**
 * What the downloaded file is called.
 *
 * The range is in the name because this file is filtered and re-exported all term, and three
 * downloads called `attendance-swe-f26.csv` in one folder are three files nobody can tell apart.
 */
export function attendanceCsvFilename(params: {
  term: string;
  from: SchoolDay | null;
  to: SchoolDay | null;
}): string {
  const parts = [
    "attendance",
    slugifyCourse(params.term),
    params.from && params.to ? `${params.from}-to-${params.to}` : "",
  ].filter((part) => part !== "");

  return `${parts.join("-")}.csv`;
}

/** Nothing to download, said the same way `gradebookIsEmpty` says it. */
export function attendanceCsvIsEmpty(data: AttendanceCsvData): boolean {
  return data.sessions.length === 0 || data.fellows.length === 0;
}
