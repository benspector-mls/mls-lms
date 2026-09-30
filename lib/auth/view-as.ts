import type { Tx } from "../prisma";
import { testStudentName } from "../students/test-student";

/**
 * An instructor looking at the application as one of their fellows, and the rule that permits it.
 *
 * **Two kinds of view, one mechanism.** Any instructor of a program may look at the application as
 * any active fellow of it, read-only: what that fellow sees, their work and their feedback, with
 * every write refused. An admin looking through a *test student* is the one writable view, because
 * that is how a course is checked end to end — accepting work, pushing, submitting, and then
 * grading it from the other side. `readOnly` on the result is what separates the two, and
 * `protectedProcedure` in trpc/init.ts is what enforces it.
 *
 * **One cookie, re-checked on every request.** The cookie holds a student's profile id and nothing
 * else. It is not signed and does not need to be, because it is never trusted: every read
 * re-establishes that the signed-in user may look at that student. A cookie forged by anybody else
 * buys nothing, and a cookie left behind by an instructor who was later taken off the program stops
 * working the moment the row goes rather than when they next sign in.
 *
 * **The switch is one field.** `createTRPCContext` replaces the id on the context's user with the
 * student's, and `ctx.user` is read for its `.id` and nothing else — `profileProcedure` loads a
 * profile with it, `_app.me` selects with it. So `requireRole` sees STUDENT, the sidebar renders
 * student navigation, and every student read, all of which scope themselves by `ctx.profile.id`,
 * returns that fellow's data. Server Components go through the same function, so they switch too.
 *
 * **The real viewer is kept beside it**, not discarded, for two reasons. Accepting a repository
 * assignment as a test student has to invite somebody with push access, and the person who needs it
 * is whoever is doing the previewing. And the banner has to name who they are looking as, because a
 * view that looks like the real thing is a way to grade the wrong person.
 *
 * Note what deliberately does *not* work while the cookie is set: every instructor procedure refuses
 * the caller, because the caller is a student. That is correct, and it is why leaving is a route
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
 * Where the viewer was when they switched in, so leaving returns them there.
 *
 * **A second cookie rather than a second value in the first**, because the two carry different
 * authority. The one above is an entitlement and is re-established from the database on every
 * request; this one is a destination, and the worst a wrong value can do is land somebody on the
 * wrong program's roster. Keeping the checked thing to one uuid is what makes it obvious that it
 * is checked.
 *
 * **A program rather than a course**, because the roster is the program's: the View as button
 * is on that screen, and a student enrolled in several programs gives "which one did the viewer
 * come from" no answer that can be derived at the point of leaving.
 */
export const VIEW_AS_PROGRAM_COOKIE = "mls_view_as_program";

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

/**
 * Whether a destination sent by the banner is an instructor screen of this application.
 *
 * Leaving a view may return to the screen it was pressed on, and that address arrives in a form,
 * which is a value anybody can set. So only `/instructor` or a path beneath it is honoured, and
 * nothing that could leave the origin: no second slash at the start, which is a protocol-relative
 * host, and no backslash, which some browsers read as one.
 */
export function isInstructorPath(value: string): boolean {
  if (value.includes("\\") || value.startsWith("//")) return false;
  return value === "/instructor" || /^\/instructor[/?]/.test(value);
}

/** Who is looking, and who they are looking as. */
export type ViewingAs = {
  /** The real signed-in instructor or admin. What `ctx.profile` would have been. */
  viewer: {
    id: string;
    displayName: string | null;
    /** Needed at accept: this is the account invited to push to a test student's repository. */
    githubUsername: string | null;
    email: string | null;
  };
  /** The student the request is being answered as. */
  student: {
    id: string;
    displayName: string | null;
    email: string | null;
    /** Non-null for a test student, which is the one kind an admin may act as. */
    testStudentNumber: number | null;
  };
  /** False only for an admin looking through a test student. Every other view refuses writes. */
  readOnly: boolean;
};

/**
 * What the banner, the audit log, and the refusal call the student.
 *
 * A test student by its number when it has no name, since the number is what the interface calls
 * it; anybody else by their address, which every signed-in fellow has.
 */
export function viewedStudentLabel(student: ViewingAs["student"]): string {
  if (student.displayName) return student.displayName;
  if (student.testStudentNumber !== null) return testStudentName(student.testStudentNumber);
  return student.email ?? "this student";
}

/**
 * Whether this cookie value entitles this user to be answered as that student, and how.
 *
 * **The rule.** The viewer is an INSTRUCTOR or an ADMIN; the target is a STUDENT; and either the
 * viewer is an ADMIN or the target has an ACTIVE enrollment in a program the viewer instructs. The
 * view is writable only when an admin looks through a test student.
 *
 * **The target must be a STUDENT, and that check is a privilege boundary.** Without it an admin
 * could name another admin in the cookie and have every admin query answered as them, and an
 * instructor enrolled somewhere as a student could be named by another instructor of that program.
 *
 * Returns null for every failure and reports none of them, because there is no failure a caller
 * can act on: a stale cookie, an instructor taken off the program, a fellow removed from it, and a
 * forged value all mean the same thing — answer the request as the person who actually signed in.
 * The route handler that *sets* the cookie is where a refusal is worth wording, since there somebody
 * pressed a button.
 *
 * Two queries, run together, and requests without the cookie pay for neither.
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

  const [pair, taught] = await Promise.all([
    db.profile.findMany({
      where: { id: { in: [params.realUserId, params.cookieValue] } },
      select: {
        id: true,
        role: true,
        displayName: true,
        email: true,
        githubUsername: true,
        testStudentNumber: true,
      },
    }),
    // An active place on a roster this viewer teaches. Unread for an admin, who may view anybody.
    db.enrollment.findFirst({
      where: {
        studentId: params.cookieValue,
        status: "ACTIVE",
        program: { instructors: { some: { userId: params.realUserId } } },
      },
      select: { id: true },
    }),
  ]);

  const viewer = pair.find((p) => p.id === params.realUserId);
  const target = pair.find((p) => p.id === params.cookieValue);

  if (!viewer || (viewer.role !== "ADMIN" && viewer.role !== "INSTRUCTOR")) return null;
  if (!target || target.role !== "STUDENT") return null;
  if (viewer.role !== "ADMIN" && !taught) return null;

  return {
    viewer: {
      id: viewer.id,
      displayName: viewer.displayName,
      githubUsername: viewer.githubUsername,
      email: viewer.email,
    },
    student: {
      id: target.id,
      displayName: target.displayName,
      email: target.email,
      testStudentNumber: target.testStudentNumber,
    },
    readOnly: !(viewer.role === "ADMIN" && target.testStudentNumber !== null),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
