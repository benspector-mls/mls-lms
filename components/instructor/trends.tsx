import { ArrivalAveragesPanel } from "@/components/arrival-averages";
import { HelpTip } from "@/components/help-tip";
import type { ArrivalAverages } from "@/lib/attendance/arrival";
import {
  ATTENDANCE_DRIFT_REASON_LABEL,
  DRIFT_RULE,
  type RecentAttendance,
} from "@/lib/attendance/summary";
import { recentChecksSentence, type RecentChecks } from "@/lib/checks/trends";
import {
  ASSIGNMENT_DRIFT_RULE,
  DRIFT_REASON_LABEL,
  driftReasons,
  type DriftReason,
  type RecentWork,
} from "@/lib/gradebook/summary";
import { cn } from "@/lib/utils";

/**
 * The last few weeks of one fellow, rather than the term: attendance, work, and understanding.
 *
 * **Drawn in two places from one component**: the Performance tab of the fellow's program record,
 * and the top of a coaching session, where it is what the conversation starts from. Both read the
 * same server computations, `attendanceStandingFor` and `courseFiguresFor` in
 * lib/coaching/snapshot.ts, so the two cannot show different readings of the same fellow.
 *
 * **Every figure counts what went right**: sessions attended, assignments on time, work complete.
 * A coaching conversation starts from this card, and a sentence made only of misses frames the
 * fellow as a list of failures even when every count in it is zero.
 *
 * **Each attendance and work figure is green while it meets the bar and red once its rule trips**,
 * by the same rules as the attendance screen's and the gradebook's own lists. The flags those
 * rules raise sit beside the heading of their sub-section rather than on each line, so a reader
 * sees whether anything is wrong before reading any figure, then finds the red figure that tripped
 * it directly below. Understanding has no rule and so no colour; see lib/checks/trends.ts.
 */
export function Trends({
  recentAttendance,
  arrivals,
  courses,
  note,
}: {
  recentAttendance: RecentAttendance;
  arrivals: ArrivalAverages;
  courses: {
    id: string;
    name: string;
    completedAssignments: { possible: number };
    recent: RecentWork;
    checks: RecentChecks;
  }[];
  /** A line under the heading, for a screen that needs to say what this is and who sees it. */
  note?: string;
}) {
  const work = courses
    .filter((course) => course.completedAssignments.possible > 0)
    .map((course) => ({ course, reasons: driftReasons(course.recent) }));
  const coursesWithChecks = courses.filter((course) => course.checks.checks > 0);

  /*
    Both attendance clauses, each on its own, rather than `attendanceDriftReason`'s single answer:
    that function picks one reason for the drift list to sort by, but here each clause colours its
    own figure, and a red figure with no flag naming it would be unexplained. Neither applies to a
    fellow too new to judge, which is the drift list's own minimum.
  */
  const enoughSessions = recentAttendance.missedOf >= DRIFT_RULE.needsAtLeast;
  const absent = enoughSessions && recentAttendance.missed >= DRIFT_RULE.missedAtLeast;
  const late = enoughSessions && recentAttendance.late >= DRIFT_RULE.lateAtLeast;
  const attendanceFlags = [
    ...(absent ? [ATTENDANCE_DRIFT_REASON_LABEL.missing] : []),
    ...(late ? [ATTENDANCE_DRIFT_REASON_LABEL.late] : []),
  ];
  /* Once per reason, however many courses trip it: the red figures below say which courses. */
  const workFlags = (["deadlines", "falling-short"] as const)
    .filter((reason) => work.some((entry) => entry.reasons.includes(reason)))
    .map((reason) => DRIFT_REASON_LABEL[reason]);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        Trends
        <HelpTip>
          The last few weeks, not the whole term, so a recent slip is not hidden by a good term
          average.
        </HelpTip>
      </h2>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex flex-col gap-2">
          <SubHeading
            title="Attendance"
            help={
              <>
                Flagged after missing {DRIFT_RULE.missedAtLeast} or more of the last{" "}
                {DRIFT_RULE.missedOf} sessions, or arriving late {DRIFT_RULE.lateAtLeast} or more
                times in the last {DRIFT_RULE.lateOf}. Arrival averages count only sessions they
                checked in.
              </>
            }
            flags={attendanceFlags}
          />
          <AttendanceLine recent={recentAttendance} absent={absent} late={late} />
          <ArrivalAveragesPanel
            averages={arrivals}
            emptyNote="They have not checked in enough times yet for an average."
          />
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <SubHeading
            title="Work"
            help={
              <>
                A course is flagged after {ASSIGNMENT_DRIFT_RULE.slippedAtLeast} or more of the last{" "}
                {ASSIGNMENT_DRIFT_RULE.dueOf} assignments due were missed or handed in late, or{" "}
                {ASSIGNMENT_DRIFT_RULE.incompleteAtLeast} or more of their last{" "}
                {ASSIGNMENT_DRIFT_RULE.gradedOf} graded fell short. The same rule as the
                gradebook&apos;s own list. The on-time figure appears once{" "}
                {ASSIGNMENT_DRIFT_RULE.slippedAtLeast} assignments are past due, and the complete
                figure once {ASSIGNMENT_DRIFT_RULE.incompleteAtLeast} are graded, because those are
                the fewest the rule can flag.
              </>
            }
            flags={workFlags}
          />
          {work.length === 0 ? (
            <p className="text-sm">No course has released work yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {work.map(({ course, reasons }) => (
                <li
                  key={course.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm"
                >
                  <span className="font-medium">{course.name}</span>
                  <WorkLine recent={course.recent} reasons={reasons} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <SubHeading title="Understanding" />
          {coursesWithChecks.length === 0 ? (
            <p className="text-sm">No course has a check for understanding yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {coursesWithChecks.map((course) => (
                <li
                  key={course.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm"
                >
                  <span className="font-medium">{course.name}</span>
                  <span className="text-muted-foreground">
                    {capitalise(recentChecksSentence(course.checks) ?? "")}.
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** A sub-section's heading, with the flags its rule raised beside it. */
function SubHeading({
  title,
  help,
  flags = [],
}: {
  title: string;
  help?: React.ReactNode;
  flags?: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
        {help && <HelpTip>{help}</HelpTip>}
      </h3>
      {flags.map((flag) => (
        <span key={flag} className="text-xs font-medium text-destructive">
          {flag}
        </span>
      ))}
    </div>
  );
}

/**
 * A count measured against a rule, with the window it was counted over: green while it meets the
 * bar, red once it trips. The whole phrase is coloured — "9 of the last 10 sessions" — because the
 * count means nothing without the window, and the rest of the line is muted so the course names
 * stand out.
 */
function Figure({ flagged, children }: { flagged: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        flagged ? "text-destructive" : "text-emerald-700 dark:text-emerald-300",
      )}
    >
      {children}
    </span>
  );
}

/**
 * "Attended 9 of the last 10 sessions · On time 7 times".
 *
 * Both counts come from one window, which `DRIFT_RULE` guarantees: the sessions not missed are the
 * ones attended, and of those, the ones not late were on time. A window still filling says how many
 * sessions it holds so far.
 *
 * **Nothing until there are `DRIFT_RULE.needsAtLeast` sessions**, the way an arrival average waits
 * for `MIN_ARRIVALS` check-ins. Two sessions are not a trend, and "attended 1 of the 2 sessions so
 * far" printed in red would flag a fellow the attendance screen's drift list deliberately does not.
 *
 * **Nothing about punctuality when nothing was attended.** The lateness rule counts late arrivals,
 * and a fellow who attended nothing arrived late zero times, so the rule cannot trip: "On time 0
 * times" would print green beside a red attendance figure, as though it were a good sign.
 */
function AttendanceLine({
  recent,
  absent,
  late,
}: {
  recent: RecentAttendance;
  absent: boolean;
  late: boolean;
}) {
  if (recent.missedOf < DRIFT_RULE.needsAtLeast) {
    return (
      <p className="text-xs text-muted-foreground">
        Not enough sessions yet for a trend. A trend needs {DRIFT_RULE.needsAtLeast} of them.
      </p>
    );
  }

  const attended = recent.missedOf - recent.missed;
  const onTime = attended - recent.late;
  const window =
    recent.missedOf === DRIFT_RULE.missedOf
      ? `the last ${recent.missedOf} sessions`
      : `the ${recent.missedOf} ${recent.missedOf === 1 ? "session" : "sessions"} so far`;

  return (
    <p className="text-sm text-muted-foreground">
      Attended{" "}
      <Figure flagged={absent}>
        {attended} of {window}
      </Figure>
      {attended > 0 && (
        <>
          {" "}
          · On time{" "}
          <Figure flagged={late}>
            {onTime} {onTime === 1 ? "time" : "times"}
          </Figure>
        </>
      )}
    </p>
  );
}

/**
 * "Submitted 9 of the last 10 assignments on time · 4 of the last 5 graded were complete".
 *
 * Missed and late both count against "on time", because the rule counts them together.
 *
 * **Each half waits until its rule could trip**: `slippedAtLeast` assignments past due, and
 * `incompleteAtLeast` graded. Below those counts the rule cannot flag anything, so every figure
 * would be green over a sample too small to mean much. Waiting for any more than that would hide a
 * course the gradebook's own list is already flagging.
 */
function WorkLine({ recent, reasons }: { recent: RecentWork; reasons: DriftReason[] }) {
  const { missed, late, due, incomplete, graded } = recent;
  const onTime = due - missed - late;
  const complete = graded - incomplete;

  const dueWindow =
    due === ASSIGNMENT_DRIFT_RULE.dueOf
      ? `the last ${due} assignments`
      : `the ${due} ${due === 1 ? "assignment" : "assignments"} due so far`;
  const gradedWindow =
    graded === ASSIGNMENT_DRIFT_RULE.gradedOf
      ? `the last ${graded} graded`
      : `the ${graded} graded so far`;

  return (
    <span className="text-muted-foreground">
      {due < ASSIGNMENT_DRIFT_RULE.slippedAtLeast ? (
        "Not enough past due yet"
      ) : (
        <>
          Submitted{" "}
          <Figure flagged={reasons.includes("deadlines")}>
            {onTime} of {dueWindow}
          </Figure>{" "}
          on time
        </>
      )}
      {" · "}
      {graded < ASSIGNMENT_DRIFT_RULE.incompleteAtLeast ? (
        "not enough graded yet"
      ) : (
        <>
          <Figure flagged={reasons.includes("falling-short")}>
            {complete} of {gradedWindow}
          </Figure>{" "}
          {complete === 1 ? "was" : "were"} complete
        </>
      )}
    </span>
  );
}

function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
