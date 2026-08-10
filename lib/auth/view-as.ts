import type { Tx } from "../prisma";

/**
 * An admin looking at the application as a test student, and the rule that permits it.
 *
 * **One cookie, re-checked on every request.** The cookie holds a test student's profile id and
 * nothing else. It is not signed and does not need to be, because it is never trusted: every read
 * re-establishes that the signed-in user is an ADMIN and that the profile named is a test student.
 * A cookie forged by anybody else buys nothing, and a cookie left behind by an admin who was later
 * demoted stops working the moment their role changes rather than when they next sign in.
 *
 * **The switch is one field.** `createTRPCContext` replaces the id on the context's user with the
 * test student's, and `ctx.user` is read for its `.id` and nothing else — `profileProcedure` loads
 * a profile with it, `_app.me` selects with it. So `requireRole` sees STUDENT, `studentProcedure`
 * admits the caller, `assertActiveStudent` finds the enrollment, the sidebar renders student
 * navigation, and `courses.listMine` returns the test student's courses. Server Components go
 * through the same function, so they switch too. That the whole feature is one substitution is the
 * dividend of there having been a single place the session is read.
 *
 * **The real admin is kept beside it**, not discarded, for two reasons. Accepting a repository
 * assignment has to invite somebody with push access, and the person who needs it is whoever is
 * doing the previewing. And the banner has to name who is looking and who they are looking as,
 * because a preview that looks like the real thing is a way to grade the wrong person.
 *
 * Note what deliberately does *not* work while the cookie is set: `adminProcedure` refuses the
 * caller, because the caller is a student. That is correct, and it is why leaving is a route
 * handler reading the real Supabase session rather than a mutation.
 */

/**
 * The cookie's name.
 *
 * `mls_` prefixed to keep it clear of Supabase's own `sb-*` cookies, which the auth client owns and
 * rewrites.
 */
export const VIEW_AS_COOKIE = "mls_view_as";

/**
 * Where the admin was when they switched in, so leaving returns them there.
 *
 * **A second cookie rather than a second value in the first**, because the two carry different
 * authority. The one above is an entitlement and is re-established from the database on every
 * request; this one is a destination, and the worst a wrong value can do is land somebody on the
 * wrong course's settings. Keeping the checked thing to one uuid is what makes it obvious that it
 * is checked.
 *
 * A test student can be enrolled in several courses, so this cannot be derived at the point of
 * leaving — the question is not which course it is in, it is which one the admin came from.
 */
export const VIEW_AS_COURSE_COOKIE = "mls_view_as_course";

/**
 * Whether a string is shaped like a uuid.
 *
 * Exported so the route handlers check a cookie the same way `resolveViewAs` does. It matters most
 * for the course cookie, whose value is interpolated into a redirect path: a value from a cookie is
 * a value somebody can set, and a path built from one that was never checked is how a redirect
 * becomes somebody else's.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Who is looking, and who they are looking as. */
export type ViewingAs = {
  /** The real signed-in admin. What `ctx.profile` would have been. */
  admin: {
    id: string;
    displayName: string | null;
    /** Needed at accept: this is the account invited to push to the test student's repository. */
    githubUsername: string | null;
    email: string | null;
  };
  /** The test student the request is being answered as. */
  testStudent: {
    id: string;
    /** Its number, which is also what says it is a test student at all. */
    number: number;
    displayName: string | null;
    email: string | null;
  };
};

/**
 * Whether this cookie value entitles this user to be answered as that test student.
 *
 * Returns null for every failure and reports none of them, because there is no failure a caller
 * can act on: a stale cookie, a demoted admin, a deleted test student, and a forged value all mean
 * the same thing — answer the request as the person who actually signed in. The route handler that
 * *sets* the cookie is where a refusal is worth wording, since there somebody pressed a button.
 *
 * One query rather than two. The pair is loaded together and sorted out here, so the cost of a
 * request made under the cookie is a single extra read, and requests without it pay nothing.
 *
 * Takes a `Tx` rather than reaching for the module's client, for the reason `accept.ts` does: rows
 * written inside a caller's transaction are invisible to the module's own client, so a check script
 * can only drive this against real rows if the client comes in.
 */
export async function resolveViewAs(
  db: Tx,
  params: { realUserId: string; cookieValue: string },
): Promise<ViewingAs | null> {
  // A cookie that is not a uuid cannot match a profile id, and passing it to Prisma would raise
  // rather than miss. Cheaper to refuse the shape than to ask the database about it.
  if (!isUuid(params.cookieValue)) return null;
  if (params.cookieValue === params.realUserId) return null;

  const pair = await db.profile.findMany({
    where: { id: { in: [params.realUserId, params.cookieValue] } },
    select: {
      id: true,
      role: true,
      displayName: true,
      email: true,
      githubUsername: true,
      testStudentNumber: true,
    },
  });

  const admin = pair.find((p) => p.id === params.realUserId);
  const target = pair.find((p) => p.id === params.cookieValue);

  if (!admin || admin.role !== "ADMIN") return null;
  if (!target || target.testStudentNumber === null) return null;

  return {
    admin: {
      id: admin.id,
      displayName: admin.displayName,
      githubUsername: admin.githubUsername,
      email: admin.email,
    },
    testStudent: {
      id: target.id,
      number: target.testStudentNumber,
      displayName: target.displayName,
      email: target.email,
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
