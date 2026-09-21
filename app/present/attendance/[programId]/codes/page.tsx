import { Suspense } from "react";

import { AttendanceCodesSheet } from "@/components/instructor/attendance-codes-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addSchoolDays, schoolDayOf, schoolDaySchema } from "@/lib/school-time";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Three weeks of codes, laid out to be printed.
 *
 * **Outside `app/(shell)/`**, like the projector page beside it and for a related reason: what
 * comes out of a printer should be the sheet and nothing else — no sidebar naming every other
 * program, no breadcrumb, no header band.
 *
 * Leaving the shell costs no authorization. `lib/supabase/proxy.ts` redirects every path except
 * `/`, `/login`, and `/auth`, so an unauthenticated visitor never arrives here — and
 * `attendance.upcoming` is instructor-gated behind that, so a signed-in fellow who guesses the
 * address is refused by the procedure rather than by the route.
 *
 * **The start date is a search parameter, and the picker is a plain form.** No client component
 * and no state: choosing a date navigates, the server renders that window, and the address records
 * exactly what was printed. The picker carries `print:hidden` so it is on the screen and not on
 * the paper.
 */

/**
 * How long a sheet covers, counted in calendar days from the start date, inclusive.
 *
 * Twenty-one, so a sheet started on a Tuesday runs through the Monday three weeks later — which is
 * the rhythm somebody printing at the end of a day actually works to. Counted in calendar days
 * rather than in meeting days because the *sheet* is what has a lifetime; how many mornings fall
 * inside it is whatever the program's schedule says, and a break simply makes for a shorter sheet.
 */
const WINDOW_DAYS = 21;

export default function PresentAttendanceCodesPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <Sheet params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Sheet({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { programId } = await params;
  const { from: asked } = await searchParams;

  const today = schoolDayOf(new Date());
  // A malformed or missing `from` falls back to today rather than refusing: this page is opened
  // from a link, and a broken address should print today's sheet, not an error.
  const from = schoolDaySchema.safeParse(asked).success ? asked! : today;
  const to = addSchoolDays(from, WINDOW_DAYS - 1);

  const upcoming = await getQueryClient().fetchQuery(
    trpc.attendance.upcoming.queryOptions({ programId }),
  );

  /*
    `upcoming` carries every day from today to the end of the program, so the window is applied
    here. A start date in the past simply begins at today, because there is nothing behind it to
    return — which is the right answer for a sheet whose whole purpose is the days ahead.
  */
  const days = upcoming.days
    .filter((session) => session.day >= from && session.day <= to)
    .map((session) => ({ day: session.day, code: session.code }));

  return (
    <div className="bg-white">
      <form
        method="get"
        className="mx-auto flex max-w-3xl flex-wrap items-end gap-3 px-8 pt-6 print:hidden"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-black">Start the sheet on</span>
          <Input type="date" name="from" defaultValue={from} className="w-40 bg-white text-black" />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Show three weeks
        </Button>
        <p className="text-xs text-black/60">
          {days.length} {days.length === 1 ? "day" : "days"} in this window. Print when it looks
          right.
        </p>
      </form>

      <AttendanceCodesSheet
        programName={upcoming.program.name}
        term={upcoming.program.term}
        from={from}
        to={to}
        days={days}
      />
    </div>
  );
}
