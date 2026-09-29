import { ArrivalAveragesPanel } from "@/components/arrival-averages";
import { HelpTip } from "@/components/help-tip";
import type { ArrivalAverages } from "@/lib/attendance/arrival";
import {
  ATTENDANCE_DRIFT_REASON_LABEL,
  attendanceDriftReason,
  DRIFT_RULE,
  recentAttendanceSentence,
  type RecentAttendance,
} from "@/lib/attendance/summary";
import { CHECK_TREND_RULE, recentChecksSentence, type RecentChecks } from "@/lib/checks/trends";
import {
  ASSIGNMENT_DRIFT_RULE,
  DRIFT_REASON_LABEL,
  driftReasons,
  recentWorkSentence,
  type RecentWork,
} from "@/lib/gradebook/summary";

/**
 * The last few weeks of one fellow, rather than the term: attendance, work, and understanding.
 *
 * **Drawn in two places from one component**: the Performance tab of the fellow's program record,
 * and the top of a coaching session, where it is what the conversation starts from. Both read the
 * same server computations, `attendanceStandingFor` and `courseFiguresFor` in
 * lib/coaching/snapshot.ts, so the two cannot show different readings of the same fellow.
 *
 * Attendance and work turn red when their rule trips, by the same rules as the attendance screen's
 * and the gradebook's own lists. Understanding never does; see lib/checks/trends.ts.
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
  const coursesWithWork = courses.filter((course) => course.completedAssignments.possible > 0);
  const coursesWithChecks = courses.filter((course) => course.checks.checks > 0);
  const attendanceReason = attendanceDriftReason(recentAttendance);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        Trends
        <HelpTip>
          The last few weeks rather than the term. Somebody at 88 percent who has slipped this
          fortnight is the person to talk to today, and a term-long figure hides them behind the
          good weeks.
        </HelpTip>
      </h2>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Attendance
            <HelpTip>
              Flagged after missing {DRIFT_RULE.missedAtLeast} or more of the last{" "}
              {DRIFT_RULE.missedOf} mornings, or arriving late {DRIFT_RULE.lateAtLeast} or more
              times in the last {DRIFT_RULE.lateOf}. The same rule as the attendance screen&apos;s
              own list. Only mornings they checked in count towards when they arrive, so an absence
              neither raises nor lowers those averages.
            </HelpTip>
          </h3>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {attendanceReason !== null && (
              <span className="font-medium text-destructive">
                {ATTENDANCE_DRIFT_REASON_LABEL[attendanceReason]}
              </span>
            )}
            <span>{recentAttendanceSentence(recentAttendance)}</span>
          </p>
          <ArrivalAveragesPanel
            averages={arrivals}
            emptyNote="They have not checked in enough times yet for an average."
          />
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Work
            <HelpTip>
              A course is flagged after {ASSIGNMENT_DRIFT_RULE.slippedAtLeast} or more of the last{" "}
              {ASSIGNMENT_DRIFT_RULE.dueOf} assignments due were missed or handed in late, or{" "}
              {ASSIGNMENT_DRIFT_RULE.incompleteAtLeast} or more of their last{" "}
              {ASSIGNMENT_DRIFT_RULE.gradedOf} graded fell short. The same rule as the
              gradebook&apos;s own list.
            </HelpTip>
          </h3>
          {coursesWithWork.length === 0 ? (
            <p className="text-sm">No course has released work yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {coursesWithWork.map((course) => {
                const reasons = driftReasons(course.recent);
                return (
                  <li key={course.id} className="flex flex-col gap-0.5 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{course.name}</span>
                      {reasons.map((reason) => (
                        <span key={reason} className="font-medium text-destructive">
                          {DRIFT_REASON_LABEL[reason]}
                        </span>
                      ))}
                    </span>
                    <span>{recentWorkSentence(course.recent)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Understanding
            <HelpTip>
              Their last {CHECK_TREND_RULE.checksOf} checks for understanding in each course: how
              many they answered, how many ended Blocked on their latest attempt, and whether they
              asked to go over those with an instructor. A check never flags here. It is an honest
              reading, not a verdict, so what it means is yours to judge.
            </HelpTip>
          </h3>
          {coursesWithChecks.length === 0 ? (
            <p className="text-sm">No course has a check for understanding yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {coursesWithChecks.map((course) => (
                <li key={course.id} className="flex flex-col gap-0.5 text-sm">
                  <span className="font-medium">{course.name}</span>
                  <span>{capitalise(recentChecksSentence(course.checks) ?? "")}.</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
