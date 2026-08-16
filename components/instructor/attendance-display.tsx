"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

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
 * **Three details here are the difference between working and appearing broken:**
 *
 * The countdown renders only after mount, in the manner of `theme-toggle.tsx`. A bar whose width
 * is computed during render is a guaranteed hydration mismatch, because the server and the browser
 * do not read the clock at the same instant.
 *
 * The address is built from `window.location.origin` in an effect, as `JoinLinkCard` does, because
 * the server rendering this has no reliable idea which host the instructor is looking at.
 *
 * And a code that has gone stale is replaced rather than left on screen. A projected code that no
 * longer works is not one person's confusion — it is the whole room failing to check in at once,
 * and then concluding the application is broken.
 */

type CodeView = RouterOutputs["attendance"]["currentCode"];

export function AttendanceDisplay({ initial }: { initial: CodeView }) {
  const trpc = useTRPC();

  const query = useQuery({
    ...trpc.attendance.currentCode.queryOptions({ sessionId: initial.session.id }),
    initialData: initial,
    /*
      Re-read as the slot turns over rather than on a fixed interval, so the screen changes when
      the code does. A second of slack absorbs the round trip; the server accepts the previous
      slot's code anyway, so nobody is punished by arriving a moment late.
    */
    refetchInterval: (q) => {
      const rotatesAt = q.state.data?.rotatesAt;
      if (!rotatesAt) return false;
      return Math.max(1000, rotatesAt.getTime() - Date.now() + 250);
    },
    staleTime: 0,
  });

  const view = query.data;

  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);

  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const rotatesAt = view.rotatesAt?.getTime() ?? null;
  // Five seconds past the rotation with no fresh code means the poll is not landing. Better to say
  // so than to leave four digits nobody can use standing at the front of the room.
  const stale = now !== null && rotatesAt !== null && now > rotatesAt + 5000;
  const remaining = now !== null && rotatesAt !== null ? Math.max(0, rotatesAt - now) : 0;
  const fraction = Math.min(1, remaining / 30000);

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
      {stale || !view.code ? (
        <>
          <p className="font-mono text-[16vw] leading-none font-bold tracking-[0.1em] tabular-nums text-muted-foreground">
            — — — —
          </p>
          <p className="text-[1.6vw] text-muted-foreground">Reconnecting…</p>
        </>
      ) : (
        <>
          <p className="font-mono text-[16vw] leading-none font-bold tracking-[0.1em] tabular-nums">
            {view.code.slice(0, 2)}
            <span className="inline-block w-[4vw]" />
            {view.code.slice(2)}
          </p>

          <div
            aria-hidden="true"
            className="h-[1vh] w-[40vw] overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 ease-linear"
              style={{ width: `${fraction * 100}%` }}
            />
          </div>
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
