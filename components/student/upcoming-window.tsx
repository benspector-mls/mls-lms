"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { CalendarClock } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UPCOMING_WINDOW_CHOICES, UPCOMING_WINDOW_COOKIE } from "@/lib/student/dashboard";

/**
 * How far ahead a fellow wants Coming up to look.
 *
 * **In the page header rather than in the Coming up section**, which is the whole reason it is
 * useful. That section is not drawn at all when nothing falls inside the window, so a control
 * living inside it would disappear at exactly the moment somebody wanted to widen it — a screen
 * saying "nothing due in the next 3 days" with no way to ask about the next thirty.
 *
 * **A cookie written here, not a mutation.** The choice is a remembered way of looking at one
 * screen: it grants nothing, hides nothing from anybody else, and needs no round trip. That is the
 * argument `RememberPlace` makes in `components/app-shell.tsx` for `mls_last_place`, and shadcn's
 * own sidebar cookie makes the same one. What it costs is that the choice is remembered per
 * browser, so the same fellow on their phone starts at the default again.
 *
 * **The lists themselves stay on the server.** `StudentDashboard` renders every row as HTML and
 * costs no client JavaScript, so this asks for a fresh render rather than filtering in the browser
 * — the alternative would have made the whole dashboard a client component to save one refresh.
 */
export function UpcomingWindowPicker({ value }: { value: number }) {
  const router = useRouter();

  /*
    Held locally as well as passed in, so the trigger changes the instant it is clicked. The server
    render behind it arrives a moment later carrying the same number, and the two agree from then
    on; without this the control would sit on the old choice until the round trip finished, which
    reads as a control that did not work.
  */
  const [days, setDays] = React.useState(value);

  /*
    Null means the select was cleared rather than changed, which this one has no control for.
    Reading it as "no change" is the safe direction, following `CohortPicker`: the far edge of the
    window moves only when somebody asked it to.
  */
  function choose(next: string | null) {
    if (next == null) return;

    setDays(Number(next));

    /*
      Six months, which is roughly a program: long enough that nobody re-chooses partway through
      their course, short enough to expire on a browser nobody has signed into since last year.
      Not `httpOnly`, because this is what writes it — and nothing trusts it, since the page checks
      the value against `UPCOMING_WINDOW_CHOICES` on every read.
    */
    const maxAge = 60 * 60 * 24 * 180;
    document.cookie = `${UPCOMING_WINDOW_COOKIE}=${next}; path=/; max-age=${maxAge}; samesite=lax`;

    router.refresh();
  }

  return (
    <Select
      value={String(days)}
      onValueChange={choose}
      /*
        Required, because the value is a number of days and the label is a sentence about it.
        Without the map the trigger renders the value itself — a bare "14" in the page header.
        Built from the list so the two cannot come to disagree about what is on offer.
      */
      items={Object.fromEntries(UPCOMING_WINDOW_CHOICES.map((d) => [String(d), `Next ${d} days`]))}
    >
      <SelectTrigger className="w-[150px] min-w-0" aria-label="How far ahead to look">
        <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {UPCOMING_WINDOW_CHOICES.map((d) => (
          <SelectItem key={d} value={String(d)}>
            Next {d} days
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
