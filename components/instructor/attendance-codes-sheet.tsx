import { formatSchoolDay, type SchoolDay } from "@/lib/school-time";

/**
 * Three weeks of codes, on paper, for whoever opens the building.
 *
 * **This is the reason the whole feature exists.** An instructor is not always in before the first
 * fellow, and the code has to be at the front desk anyway. This is the sheet that goes there.
 *
 * **A window rather than a count.** It prints the days the program meets between a start date and
 * three weeks later, however many that turns out to be — fifteen for a full Monday-to-Friday
 * stretch, fewer across a break. Counting days instead would hand somebody a sheet that looked
 * three weeks long and ran out in the middle of the second, because the days it skipped were the
 * ones the program had cancelled.
 *
 * **Three weeks, and the start date is chosen.** The sheet is replaced on a fixed rhythm, so
 * whoever prints it does so at the end of a day and starts it on the next one. A term of codes on
 * one sheet would be a sheet somebody keeps in a drawer, and a code kept in a drawer is one still
 * being read out three months after the day it belonged to was removed.
 *
 * **Two columns and no hours.** Fourteen rows across a full page did not fit a printer. The hours
 * each code works are the same on every row — the rule is in the paragraph at the top — so the
 * column saying so was the same sentence fifteen times, and dropping it leaves a narrow pair of
 * lists that fit side by side.
 *
 * Server-rendered and static: no polling, no clock, nothing that changes under somebody standing
 * at a printer. The warning at the top is the honest part — replacing a code or removing a day
 * makes a printed row wrong, and nothing here can know that has happened.
 *
 * Black on white, because this page's only destination is a printer.
 */

type Day = {
  day: SchoolDay;
  code: string;
};

export function AttendanceCodesSheet({
  programName,
  term,
  from,
  to,
  days,
}: {
  programName: string;
  term: string;
  /** The first day of the window, inclusive. */
  from: SchoolDay;
  /** Three weeks after it, inclusive. */
  to: SchoolDay;
  /** Only the days the program meets inside the window, in order. */
  days: Day[];
}) {
  // Down the left column first, then the right, so the pair reads as one list rather than as two.
  const half = Math.ceil(days.length / 2);
  const columns = [days.slice(0, half), days.slice(half)];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 bg-white p-8 text-black print:p-0">
      <header className="flex flex-col gap-1 border-b border-black/20 pb-3">
        <h1 className="text-xl font-semibold">{programName} — check-in codes</h1>
        <p className="text-xs">
          {term} · {formatSchoolDay(from)} to {formatSchoolDay(to)}
        </p>
        <p className="max-w-prose pt-1 text-xs">
          Give out <strong>today&rsquo;s code only</strong>. Each code works from two hours before
          class until eight hours after class starts, on its own day and no other. If an instructor
          replaces a code or removes a day, the row for that day is wrong — ask them for a new sheet.
        </p>
      </header>

      {days.length === 0 ? (
        <p className="text-xs">
          This program meets on none of the days between {formatSchoolDay(from)} and{" "}
          {formatSchoolDay(to)}.
        </p>
      ) : (
        <div className="flex items-start gap-8">
          {columns.map((column, index) =>
            column.length === 0 ? null : (
              <table key={index} className="flex-1 border-collapse text-left">
                <thead>
                  <tr className="border-b border-black/20">
                    <th className="py-1 text-[0.7rem] font-semibold uppercase tracking-wide">Day</th>
                    <th className="py-1 text-[0.7rem] font-semibold uppercase tracking-wide">
                      Code
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {column.map((day) => (
                    <tr key={day.day} className="border-b border-black/10">
                      <td className="py-1.5 pr-3 text-xs whitespace-nowrap">
                        {formatSchoolDay(day.day)}
                      </td>
                      <td className="py-1.5 font-mono text-lg font-bold tracking-[0.15em] tabular-nums">
                        {day.code}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          )}
        </div>
      )}
    </main>
  );
}
