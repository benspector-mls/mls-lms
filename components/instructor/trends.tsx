import { ArrivalAveragesPanel } from "@/components/arrival-averages";
import { HelpTip } from "@/components/help-tip";
import type { ArrivalAverages } from "@/lib/attendance/arrival";
import {
  ATTENDANCE_DRIFT_REASON_LABEL,
  DRIFT_RULE,
  recentAttendedShare,
  recentOnTimeArrivalShare,
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
 * **Drawn whole on the Trends tab of the fellow's record and at the top of a coaching session**,
 * where it is what the conversation starts from and having every recent reading in one card is
 * the point. The Performance tab of the record draws the same pieces instead in the section each
 * belongs to — `AttendanceTrend` at the top of Attendance, `CourseTrend` under each course row —
 * so a reader scans each area once. All read the same server computations, `attendanceStandingFor`
 * and `courseFiguresFor` in lib/coaching/snapshot.ts, so no two can show different readings of
 * the same fellow.
 *
 * **Headed "Last few weeks" rather than "Trends"**, because it is the first section of the Trends
 * tab, and a section named after its tab reads as the whole tab. The heading names the window,
 * which is the one thing that separates this card from the Performance tab's term figures.
 *
 * **Its heading's rank and size are set by the caller**, because the card sits at two depths: a
 * top-level section of the Trends tab, beside Themes, and one part of the coaching form's "Before
 * the session", under that part's own heading.
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
  id,
  level,
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
  /** The section's anchor, where a page's outline links to it. */
  id?: string;
  /** 2 as a section of a tab, at a section heading's size; 3 inside a part of the coaching form. */
  level: 2 | 3;
}) {
  const work = courses
    .filter((course) => course.completedAssignments.possible > 0)
    .map((course) => ({ course, reasons: driftReasons(course.recent) }));
  const coursesWithChecks = courses.filter((course) => course.checks.checks > 0);
  const HeadingTag = level === 2 ? "h2" : "h3";

  /* Once per reason, however many courses trip it: the red figures below say which courses. */
  const workFlags = (["deadlines", "falling-short"] as const)
    .filter((reason) => work.some((entry) => entry.reasons.includes(reason)))
    .map((reason) => DRIFT_REASON_LABEL[reason]);

  return (
    <section id={id} className="flex scroll-mt-(--outline-offset) flex-col gap-2">
      <HeadingTag
        className={cn(
          "flex items-center gap-1.5",
          level === 2 ? "text-lg font-semibold" : "text-sm font-medium",
        )}
      >
        Last few weeks
        <HelpTip>
          Not the whole term, so a recent slip is not hidden by a good term average.
        </HelpTip>
      </HeadingTag>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4">
        <AttendanceTrend recentAttendance={recentAttendance} arrivals={arrivals} />
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <SubHeading title="Work" help={<WorkRuleHelp />} flags={workFlags} />
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

/**
 * The attendance half of Trends on its own: the last few mornings, with the flags their rule
 * raised, and the arrival averages. The fellow's record draws it at the top of its Attendance
 * section, titled for where it sits there.
 */
export function AttendanceTrend({
  recentAttendance,
  arrivals,
  title = "Attendance",
}: {
  recentAttendance: RecentAttendance;
  arrivals: ArrivalAverages;
  title?: string;
}) {
  /*
    Both attendance clauses, each on its own, rather than `attendanceDriftReason`'s single answer:
    that function picks one reason for a flag to name, but here each clause colours its own figure,
    and a red figure with no flag naming it would be unexplained. Neither applies to a fellow too
    new to judge, which is the drift rule's own minimum.
  */
  const attended = recentAttendedShare(recentAttendance);
  const onTime = recentOnTimeArrivalShare(recentAttendance);
  const absent = attended !== null && attended < DRIFT_RULE.attendedAtLeast;
  const late = onTime !== null && onTime < DRIFT_RULE.onTimeAtLeast;
  const attendanceFlags = [
    ...(absent ? [ATTENDANCE_DRIFT_REASON_LABEL.missing] : []),
    ...(late ? [ATTENDANCE_DRIFT_REASON_LABEL.late] : []),
  ];

  return (
    <div className="flex flex-col gap-2">
      <SubHeading
        title={title}
        help={
          <>
            Flagged when under {percentOf(DRIFT_RULE.attendedAtLeast)} of the sessions in the last
            two weeks were attended, or under {percentOf(DRIFT_RULE.onTimeAtLeast)} were arrived at
            on time, once the window holds at least {DRIFT_RULE.windowNeedsAtLeast} sessions.
            Arrival averages count only sessions they checked in.
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
  );
}

/** The rule behind the work figures, for a help tip wherever they are drawn. */
export function WorkRuleHelp() {
  return (
    <>
      A course is flagged when under {percentOf(ASSIGNMENT_DRIFT_RULE.onTimeAtLeast)} of its
      assignments due in the last two weeks were handed in on time, or under{" "}
      {percentOf(ASSIGNMENT_DRIFT_RULE.completeAtLeast)} of those with a grade were graded complete.
      Work never handed in counts as incomplete; work waiting on a grade is not counted. Neither is
      read over fewer than {ASSIGNMENT_DRIFT_RULE.needsAtLeast} assignments. The same rule as the
      gradebook&apos;s own list.
    </>
  );
}

/**
 * One course's last few weeks, for drawing beneath that course's row: the work line with any flag
 * its rule raised, and the checks for understanding. Nothing when the course has neither released
 * work nor a check, because a line about nothing would read as a finding.
 *
 * The same lines Trends draws under its Work and Understanding headings, so the record and the
 * coaching form cannot word one course differently.
 */
export function CourseTrend({
  course,
}: {
  course: { completedAssignments: { possible: number }; recent: RecentWork; checks: RecentChecks };
}) {
  const hasWork = course.completedAssignments.possible > 0;
  const checks = recentChecksSentence(course.checks);
  if (!hasWork && checks === null) return null;

  const reasons = driftReasons(course.recent);

  return (
    <div className="flex flex-col gap-0.5 text-sm">
      {hasWork && (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <WorkLine recent={course.recent} reasons={reasons} />
          {reasons.map((reason) => (
            <span key={reason} className="text-xs font-medium text-destructive">
              {DRIFT_REASON_LABEL[reason]}
            </span>
          ))}
        </p>
      )}
      {checks !== null && <p className="text-muted-foreground">{capitalise(checks)}.</p>}
    </div>
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
 * bar, red once it trips. The whole phrase is coloured — "9 of the 10 sessions" — because the
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
 * "Attended 9 of the 10 sessions in the last two weeks · On time 7 times".
 *
 * Both counts come from one window: the sessions not missed are the ones attended, and of those,
 * the ones not late were on time.
 *
 * **Nothing when the window held no sessions**, such as over a break: there is nothing to attend,
 * and "attended 0 of 0" would read as a finding.
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
  if (recent.missedOf === 0) {
    return (
      <p className="text-xs text-muted-foreground">No sessions were held in the last two weeks.</p>
    );
  }

  const attended = recent.missedOf - recent.missed;
  const onTime = attended - recent.late;

  return (
    <p className="text-sm text-muted-foreground">
      Attended{" "}
      <Figure flagged={absent}>
        {attended} of the {recent.missedOf} {recent.missedOf === 1 ? "session" : "sessions"} in the
        last two weeks
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
 * "Submitted 9 of the 10 assignments due in the last two weeks on time · 4 of the 5 graded were
 * complete".
 *
 * Missed and late both count against "on time", because the rule counts them together. The graded
 * figure counts work never handed in as graded incomplete, the same reading the Performance tab
 * gives it. Each half says so when its window is empty, rather than printing "0 of 0".
 */
function WorkLine({ recent, reasons }: { recent: RecentWork; reasons: DriftReason[] }) {
  const { missed, late, due, incomplete, graded } = recent;
  const onTime = due - missed - late;
  const complete = graded - incomplete;

  return (
    <span className="text-muted-foreground">
      {due === 0 ? (
        "Nothing due in the last two weeks"
      ) : (
        <>
          Submitted{" "}
          <Figure flagged={reasons.includes("deadlines")}>
            {onTime} of the {due} {due === 1 ? "assignment" : "assignments"} due in the last two
            weeks
          </Figure>{" "}
          on time
        </>
      )}
      {" · "}
      {graded === 0 ? (
        "nothing graded yet"
      ) : (
        <>
          <Figure flagged={reasons.includes("falling-short")}>
            {complete} of the {graded} graded
          </Figure>{" "}
          {complete === 1 ? "was" : "were"} complete
        </>
      )}
    </span>
  );
}

function percentOf(share: number): string {
  return `${Math.round(share * 100)} percent`;
}

function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
