import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { isUuid, VIEW_AS_COOKIE, VIEW_AS_PROGRAM_COOKIE } from "@/lib/auth/view-as";
import { rosterHref } from "@/lib/links";

/**
 * Leaving a test student's view, and landing back on the roster it was entered from.
 *
 * **Deliberately checks nothing about the caller.** Deleting these cookies can only ever return
 * somebody to being themselves, so there is nobody to refuse: a caller who never had them is
 * unaffected, and a caller who did wanted exactly this. Requiring a signed-in admin here would be
 * the wrong shape, because while the cookie is set the caller reads as a STUDENT — an admin guard
 * would refuse the one person entitled to press it, and strand them.
 *
 * That is the reason this is a route handler rather than a mutation: the way out must not depend on
 * the privileges the switch gives up.
 *
 * **The destination is the roster of the program the admin switched in from**, recorded at
 * that moment rather than derived here, because a test student can be enrolled in several and the
 * question is not which one it is in. The roster because that is the screen the View as button is
 * on: leaving returns somebody to where they left, which also puts them a press away from switching
 * in again — checking a course tends to take more than one look.
 *
 * `/instructor` is the fallback for a cookie that is missing, malformed, or left over from before
 * this was recorded. It redirects to the newest taught course's triage, which is somewhere real
 * rather than an error.
 */
export async function POST(request: NextRequest) {
  const jar = await cookies();
  const programId = jar.get(VIEW_AS_PROGRAM_COOKIE)?.value;

  jar.delete(VIEW_AS_COOKIE);
  jar.delete(VIEW_AS_PROGRAM_COOKIE);

  const { origin } = new URL(request.url);

  /*
    Checked before it reaches a path. The value is this application's own, but it arrives in a
    cookie, and a path built from an unchecked cookie is how a redirect becomes somebody else's.
    A program that has since been deleted needs nothing extra: the roster answers that itself.
  */
  const back = programId && isUuid(programId) ? rosterHref(programId) : "/instructor";

  redirect(`${origin}${back}`);
}
