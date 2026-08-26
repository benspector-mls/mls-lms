"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { formatSchoolTime } from "@/lib/school-time";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * The code, on a screen at the front of the room.
 *
 * **Nothing else is on this page**, which is the whole design. It carries no sidebar, no
 * breadcrumb, and no theme toggle — partly because none of that is legible at 16vw, and mostly
 * because on a shared Zoom window a sidebar naming every other cohort is information about other
 * people's courses being broadcast to a class. One window with one thing in it is also the only
 * shape Zoom's "share a window" can select cleanly.
 *
 * **This window is now one of two ways to give the code out, and no longer the necessary one.** The
 * code is fixed for the session, so an instructor teaching from a single shared window can copy it
 * off the attendance screen and paste it into the chat instead of ever opening this. What this is
 * still the best answer for is a room with a projector, where four digits at 16vw are readable from
 * the back and can simply stay there.
 *
 * There is no countdown, because there is nothing to count down to: the code lasts as long as
 * check-in does. What the screen says instead is when check-in closes, which is the only deadline
 * left and the one an instructor has to be able to see coming.
 *
 * The address is built from `window.location.origin` in an effect, as `JoinLinkCard` does, because
 * the server rendering this has no reliable idea which host the instructor is looking at.
 */

type CodeView = RouterOutputs["attendance"]["sessionCode"];

export function AttendanceDisplay({ initial }: { initial: CodeView }) {
  const trpc = useTRPC();

  const query = useQuery({
    ...trpc.attendance.sessionCode.queryOptions({ sessionId: initial.session.id }),
    initialData: initial,
    /*
      A slow fixed interval, where this used to re-read on every rotation. The code will not change
      underneath the room, so the only things worth noticing are the session closing and the
      checked-in count climbing — and fifteen seconds is well inside how long either takes to
      matter to somebody watching from the back.
    */
    refetchInterval: 15_000,
  });

  const view = query.data;

  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);

  if (view.session.state !== "open") {
    return (
      <Shell courseName={view.courseName} day={view.session.day}>
        <p className="text-[6vw] font-semibold text-muted-foreground">Check-in is closed</p>
        <p className="text-[1.6vw] text-muted-foreground">
          Reopen it from the attendance screen if class is still running.
        </p>
      </Shell>
    );
  }

  return (
    <Shell courseName={view.courseName} day={view.session.day}>
      {view.code ? (
        <>
          <p className="font-mono text-[16vw] leading-none font-bold tracking-[0.1em] tabular-nums">
            {view.code.slice(0, 2)}
            <span className="inline-block w-[4vw]" />
            {view.code.slice(2)}
          </p>

          {/*
            The one deadline left, said in words rather than drawn as a bar. A bar counting down to
            a rotation was worth animating because the number above it was about to be wrong; this
            is hours away and a projector is not the place to watch it drain.
          */}
          <p className="text-[1.6vw] text-muted-foreground">
            This code works until {formatSchoolTime(view.session.endsAt)}
          </p>
        </>
      ) : (
        <>
          <p className="font-mono text-[16vw] leading-none font-bold tracking-[0.1em] tabular-nums text-muted-foreground">
            — — — —
          </p>
          <p className="text-[1.6vw] text-muted-foreground">Reconnecting…</p>
        </>
      )}

      <div className="mt-[4vh] flex w-full items-end justify-between gap-6 text-[1.5vw] text-muted-foreground">
        <span>
          Check in at{" "}
          <span className="font-medium text-foreground">
            {origin ? `${origin.replace(/^https?:\/\//, "")}/dashboard` : "/dashboard"}
          </span>
        </span>
        <span className="tabular-nums">
          <span className="font-medium text-foreground">{view.checkedIn}</span> of {view.expected}{" "}
          checked in
        </span>
      </div>
    </Shell>
  );
}

function Shell({
  courseName,
  day,
  children,
}: {
  courseName: string;
  day: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-[3vh] px-[4vw] py-[4vh]">
      <p className="text-[1.5vw] text-muted-foreground">
        {courseName} · {day}
      </p>
      {children}
    </main>
  );
}
