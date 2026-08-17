import type { AttendanceStatus } from "@/lib/generated/prisma/enums";
import type { SchoolDay } from "@/lib/school-time";

/**
 * What one square of a fellow's own attendance says, and how it says it.
 *
 * **One vocabulary for two screens.** The month calendar on a course's attendance page and the
 * week strip on the dashboard draw different grids out of the same facts, and a fellow reading
 * both has to be told the same thing by the same colour. Two maps of Tailwind classes is how they
 * would come to disagree — see `lib/student/progress.ts`, which owns the progress bar's colours
 * for the same reason and cites the bug that followed from not doing so.
 *
 * Pure, and no `server-only`: both callers are client components.
 */

export type CellKind = AttendanceStatus | "unrecorded" | "open" | "no-session" | "not-enrolled";

export const CELL: Record<CellKind, { className: string; label: string }> = {
  PRESENT: {
    className: "bg-emerald-500/85 text-white",
    label: "Present",
  },
  /*
    Green, like PRESENT, because late counts as attended and the rate says so. What marks it out
    is the wedge below rather than a colour of its own — amber here would put it beside EXCUSED,
    which does not count.
  */
  LATE: {
    className: "bg-emerald-500/85 text-white",
    label: "Late — here, after the on-time window",
  },
  ABSENT: {
    className: "bg-destructive/85 text-white",
    label: "Absent",
  },
  EXCUSED: {
    className: "bg-amber-400/90 text-amber-950",
    label: "Excused — still counts as a session you missed",
  },
  unrecorded: {
    className: "bg-muted-foreground/30 text-foreground",
    label: "Nothing was recorded for you",
  },
  open: {
    className: "border border-primary/50 bg-primary/10 text-foreground",
    label: "Check-in is open",
  },
  // No session that day, and no session before you joined. Both are blank rather than grey:
  // a coloured square for a morning the cohort never met is the calendar inventing an absence.
  "no-session": { className: "text-muted-foreground/50", label: "" },
  "not-enrolled": { className: "text-muted-foreground/50", label: "" },
};

/**
 * The wedge in the corner of a late square.
 *
 * A shape rather than a shade, so it survives being read by somebody who cannot tell two greens
 * apart. Here rather than written out at each grid, because the two grids drawing it differently
 * would make the same morning look like two different mornings.
 */
export const LATE_WEDGE_CLASS =
  "absolute top-0 right-0 size-0 border-t-[0.45rem] border-l-[0.45rem] border-t-amber-300 border-l-transparent";

/** Whether a square stands for something that happened, as against a morning with no session. */
export function isMarked(kind: CellKind): boolean {
  return kind !== "no-session" && kind !== "not-enrolled";
}

/**
 * Which square a day gets.
 *
 * The order is the meaning. No session at all outranks everything, because a morning the cohort
 * never met has nothing to report about anybody. Then enrolment, so a fellow who joined in March
 * is blank through February rather than absent. Then whether check-in is still open, which is the
 * one state where nothing is settled yet. Only after all three does a stored status speak, and a
 * session that ran with nothing written down is `unrecorded` rather than silently present.
 */
export function kindOf(
  entry: { status: AttendanceStatus | null; open: boolean } | undefined,
  day: SchoolDay,
  enrolledFrom: SchoolDay,
): CellKind {
  if (!entry) return "no-session";
  if (day < enrolledFrom) return "not-enrolled";
  if (entry.open) return "open";
  return entry.status ?? "unrecorded";
}
