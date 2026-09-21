import { formatSchoolDay, formatSchoolTime } from "@/lib/school-time";

/**
 * A fortnight of codes, on paper, for whoever opens the building.
 *
 * **This is the reason the whole feature exists.** An instructor is not always in before the first
 * fellow, and the code has to be at the front desk anyway. This is the sheet that goes there.
 *
 * **Fourteen days, not the term.** A sheet of a hundred and ninety codes is one somebody keeps in
 * a drawer, and a code kept in a drawer is a code still being read out three months after the day
 * it belonged to was removed. Fourteen is a fortnight of cover and a sheet that gets replaced.
 *
 * Server-rendered and static: no polling, no clock, nothing that changes under somebody standing
 * at a printer. The warning at the top is the honest part — replacing a code or removing a day
 * makes a printed row wrong, and nothing here can know that has happened.
 *
 * Black on white and sized in points rather than in the application's palette, because this page's
 * only destination is a printer.
 */

const DAYS_ON_A_SHEET = 14;

type Day = {
  day: string;
  opensAt: Date | string | null;
  startedAt: Date | string | null;
  endsAt: Date | string | null;
  code: string;
};

export function AttendanceCodesSheet({
  programName,
  term,
  days,
}: {
  programName: string;
  term: string;
  days: Day[];
}) {
  const sheet = days.slice(0, DAYS_ON_A_SHEET);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 bg-white p-10 text-black print:p-0">
      <header className="flex flex-col gap-1 border-b border-black/20 pb-4">
        <h1 className="text-2xl font-semibold">{programName} — check-in codes</h1>
        <p className="text-sm">{term}</p>
        <p className="max-w-prose pt-2 text-sm">
          Give out <strong>today&rsquo;s code only</strong>. Each code works from two hours before
          class until eight hours after class starts, on its own day and no other. If an instructor
          replaces a code or removes a day, the row for that day on this sheet is wrong — ask them
          for a new sheet.
        </p>
      </header>

      {sheet.length === 0 ? (
        <p className="text-sm">
          This program has no days coming up. Set when it meets on its settings screen.
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-black/20">
              <th className="py-2 text-sm font-semibold">Day</th>
              <th className="py-2 text-sm font-semibold">Code</th>
              <th className="py-2 text-sm font-semibold">When it works</th>
            </tr>
          </thead>
          <tbody>
            {sheet.map((day) => (
              <tr key={day.day} className="border-b border-black/10">
                <td className="py-3 pr-4 text-base whitespace-nowrap">
                  {formatSchoolDay(day.day)}
                </td>
                <td className="py-3 pr-4 font-mono text-3xl font-bold tracking-[0.2em] tabular-nums">
                  {day.code}
                </td>
                <td className="py-3 text-sm">
                  {day.opensAt && day.startedAt && day.endsAt ? (
                    <>
                      {formatSchoolTime(new Date(day.opensAt))} to{" "}
                      {formatSchoolTime(new Date(day.endsAt))}, class starts{" "}
                      {formatSchoolTime(new Date(day.startedAt))}
                    </>
                  ) : (
                    "Check-in has not been opened for this day"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
