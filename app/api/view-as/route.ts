import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { recordEvent, viewAsActor } from "@/lib/audit/record";
import { isUuid, resolveViewAs, VIEW_AS_COOKIE, VIEW_AS_PROGRAM_COOKIE } from "@/lib/auth/view-as";
import { db } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/**
 * Entering a test student's view. A route handler rather than a procedure, for two reasons.
 *
 * A tRPC mutation in this application answers over `fetch` and cannot reliably write a cookie, and
 * this act is a cookie. Writing one and redirecting is what route handlers are for here already —
 * `app/auth/callback/route.ts` does exactly that with the session cookie.
 *
 * And a full navigation is wanted rather than tolerated: the sidebar, the navigation, and every
 * screen change at once, so there is nothing to invalidate and no window in which half the
 * application believes one thing and half believes another.
 *
 * Reached by a plain `<form method="post">`, so it needs no client JavaScript. The refusals below
 * are worded because somebody pressed a button here; the same checks in `resolveViewAs` report
 * nothing, because there nobody did.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const testStudentId = form.get("testStudentId");
  const programId = form.get("programId");
  const { origin } = new URL(request.url);

  if (typeof testStudentId !== "string") {
    redirect(`${origin}/auth/error?error=${encodeURIComponent("No test student named.")}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`${origin}/auth/login`);

  /*
    The same function the context uses, so the rule for entering a view and the rule for being
    answered inside one cannot drift apart. If this permits it, every later request permits it.
  */
  const viewingAs = await resolveViewAs(db, {
    realUserId: user.id,
    cookieValue: testStudentId,
  });

  if (!viewingAs) {
    redirect(
      `${origin}/auth/error?error=${encodeURIComponent(
        "Only an admin may look at a course as a test student, and only as a test student.",
      )}`,
    );
  }

  /*
    Recorded before the cookie is set, not after.

    Everything the admin does from here arrives attributed to them with `acted_as` filled in, so
    this event is what says when that began — and an admin who enters a view and then leaves the
    tab open is the case the banner exists for and the log has to be able to reconstruct. Written
    outside a transaction because there is no database change to pair it with: the act is the
    cookie, and a failure here should not stop somebody entering a preview.
  */
  await recordEvent(db, {
    action: "VIEW_AS_ENTERED",
    actor: viewAsActor(viewingAs),
    subject: {
      id: viewingAs.testStudent.id,
      label: `Test Student ${viewingAs.testStudent.number}`,
    },
    ...(typeof programId === "string" && isUuid(programId) ? { program: { id: programId } } : {}),
  });

  const jar = await cookies();
  const options = {
    httpOnly: true,
    sameSite: "lax",
    // Not readable by script and not sent on a cross-site request. `secure` off in development
    // because localhost is served over http, which would otherwise silently drop it.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // No `maxAge`: session cookies, so closing the browser leaves the view. An admin who forgets
    // they are in it is the failure this feature has to work hardest against.
  } as const;

  jar.set(VIEW_AS_COOKIE, viewingAs.testStudent.id, options);

  /*
    Where to go back to. Set from the program whose roster this was pressed on, and *cleared*
    rather than left when there is none — a stale value from a previous switch would send the admin
    back to a program they were not in this time, which is worse than the fallback.
  */
  if (typeof programId === "string" && isUuid(programId)) {
    jar.set(VIEW_AS_PROGRAM_COOKIE, programId, options);
  } else {
    jar.delete(VIEW_AS_PROGRAM_COOKIE);
  }

  // Where a student lands, because that is what the admin is now looking at.
  redirect(`${origin}/courses`);
}
