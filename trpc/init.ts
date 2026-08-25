import { initTRPC, TRPCError } from "@trpc/server";
import { cookies } from "next/headers";
import { cache } from "react";
import superjson from "superjson";
import { z } from "zod";

import { resolveViewAs, VIEW_AS_COOKIE } from "@/lib/auth/view-as";
import { assertInstructsProgram, assertTeaches } from "@/lib/courses/membership";
import { db } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/**
 * Re-exported from `lib/auth/ctx`, where it belongs: the guards that take it live in `lib/`, and
 * a domain module importing a type from the transport layer is the wrong direction. Re-exported
 * here so a router can import everything it needs from `../init`.
 */
export type { AuthedCtx } from "@/lib/auth/ctx";

/**
 * Built once per request and handed to every procedure.
 *
 * @see: https://trpc.io/docs/server/context
 */
export const createTRPCContext = cache(async () => {
  const supabase = await createClient();

  // getUser() revalidates the token against Supabase. getSession() only reads
  // and trusts the cookie, which on the server means a forged cookie would
  // authenticate. Always getUser() here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /*
    An admin looking at the application as a test student, which is the whole of that feature.

    `resolveViewAs` re-establishes the entitlement on every request — the signed-in user is an
    ADMIN, the profile named is a test student — so the cookie is a request rather than a grant.
    See `lib/auth/view-as.ts` for why it needs no signature.

    Substituting the id is enough because `ctx.user` is read for its `.id` and nothing else.
    `email` is replaced alongside it so the object does not carry one person's address under
    another's id, which is a trap for whoever next reaches for a field on it.
  */
  const cookieValue = user ? (await cookies()).get(VIEW_AS_COOKIE)?.value : undefined;
  const viewingAs =
    user && cookieValue ? await resolveViewAs(db, { realUserId: user.id, cookieValue }) : null;

  const effectiveUser =
    user && viewingAs
      ? { ...user, id: viewingAs.testStudent.id, email: viewingAs.testStudent.email ?? undefined }
      : user;

  return { db, user: effectiveUser, viewingAs };
});

type Context = Awaited<ReturnType<typeof createTRPCContext>>;

// Avoid exporting the entire t-object
// since it's not very descriptive.
// For instance, the use of a t variable
// is common in i18n libraries.
const t = initTRPC.context<Context>().create({
  /**
   * Without a transformer, responses go over the wire as plain JSON — which has
   * no Date type, so `createdAt` would arrive in the browser as a string while
   * tRPC's inferred types still claimed `Date`. Typechecks, then throws at
   * runtime. superjson sends type metadata alongside the data so Dates (and
   * Map/Set/BigInt/undefined) survive the trip.
   *
   * Must match the transformer configured on the client link in client.tsx.
   *
   * @see https://trpc.io/docs/server/data-transformers
   */
  transformer: superjson,
});

// Base router and procedure helpers
export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

/** Unauthenticated. `ctx.user` may be null. */
export const baseProcedure = t.procedure;

/**
 * Requires a signed-in user, and narrows `ctx.user` from `User | null` to
 * `User`. Building on this makes the auth check structural: `ctx.user.id` does
 * not compile on a baseProcedure, so it cannot be forgotten.
 *
 * Worth remembering that Prisma connects as the table owner and therefore
 * BYPASSES the RLS policies that protect the browser client. Inside a
 * procedure, `ctx.user.id` in the `where` clause is the only thing scoping a
 * query to its caller.
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be signed in to do that.",
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Loads the caller's profile row and adds it to the context as `ctx.profile`.
 *
 * The Supabase user object on `ctx.user` carries identity but not application
 * data, so `role` is not available there. This costs one query per request, and
 * only on procedures that need it, which is why it is a separate middleware
 * rather than part of createTRPCContext.
 *
 * A signed-in user without a profile row should be impossible, because the
 * on-signup trigger creates one. It is treated as an error rather than ignored,
 * since silently continuing would mean an unowned session.
 */
export const profileProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const profile = await ctx.db.profile.findUnique({ where: { id: ctx.user.id } });

  if (!profile) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Your account has no profile record. This should not happen — please report it.",
    });
  }

  return next({ ctx: { ...ctx, profile } });
});

/**
 * Restricts a procedure to one or more roles.
 *
 * Role checks live here rather than in page components because Prisma connects
 * as the table owner and is not restricted by row level security. Procedure code
 * is the only thing enforcing authorization, so the check must be impossible to
 * skip by accident.
 */
function requireRole(...roles: Array<"STUDENT" | "INSTRUCTOR" | "ADMIN">) {
  return profileProcedure.use(async ({ ctx, next }) => {
    if (!roles.includes(ctx.profile.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This action requires one of these roles: ${roles.join(", ")}.`,
      });
    }
    return next({ ctx });
  });
}

/** Students only. Admins are deliberately excluded: accepting an assignment
 *  creates a repository named after the caller's GitHub login, which only makes
 *  sense for an actual student. */
export const studentProcedure = requireRole("STUDENT");

/** Instructors and admins. */
export const instructorProcedure = requireRole("INSTRUCTOR", "ADMIN");

/**
 * An instructor **of this course's program**, for every procedure whose input names a course.
 *
 * The check the INSTRUCTOR role cannot make on its own: holding it says somebody is staff, not
 * which matriculations are theirs, so without this one program's instructor could author in
 * another's, rename its units, or reassign its fellows. It was
 * `await assertTeaches(ctx, input.courseId)` written out as the first line of about twenty
 * procedures — correct at every one of them, and forgettable at the twenty-first.
 *
 * **The row it looks for is on the program.** An instructor of a program may act in every course
 * of it, so a `CourseInstructor` row grants nothing and is not consulted; what it records is who
 * teaches what. See `assertTeaches` for why that is the decision.
 *
 * **Structural, the way `protectedProcedure` gates a session.** A procedure built on this cannot
 * omit the check, because there is no line to leave out. That is the same trade every guard above
 * makes, and it is worth naming: the check is no longer the first thing you read in the body, so
 * the builder's name has to carry it. Which is why this is its own name rather than a widening of
 * `instructorProcedure`.
 *
 * tRPC merges chained `.input()` schemas, so a procedure adding its own keeps `courseId` in its
 * input type and no browser call site moves.
 *
 * For the procedures whose input names a *row* rather than a course — a unit id, a submission id —
 * this cannot help: the row has to be read before anything knows which course it is in. Those use
 * the `teachable*` loaders in `lib/courses/scope.ts`, which do both in one query.
 */
export const courseProcedure = instructorProcedure
  .input(z.object({ courseId: z.string().uuid() }))
  .use(async ({ ctx, input, next }) => {
    await assertTeaches(ctx, input.courseId);
    return next();
  });

/**
 * An instructor **of this program**, for the procedures that name one rather than a course.
 *
 * The sibling of `courseProcedure`, and it exists because a program has screens of its own now:
 * attendance, the roster, the cohorts, and who teaches what. None of those has a course to reach
 * through, so `courseProcedure` cannot serve them — and writing the guard out by hand in the four
 * routers that hold them would be the same forgettable first line this pair was built to delete.
 *
 * Structural for the same reason, and one query for the same reason. `assertInstructsProgram` is
 * the whole of it, and an admin passes as an admin passes everything.
 */
export const programProcedure = instructorProcedure
  .input(z.object({ programId: z.string().uuid() }))
  .use(async ({ ctx, input, next }) => {
    await assertInstructsProgram(ctx, input.programId);
    return next();
  });

/**
 * Admins only. Who may teach, and who may decide that.
 *
 * A separate procedure rather than `ctx.profile.role === 'ADMIN'` at each call site, for the
 * reason every other guard here is one: a check remembered at seven places is a check forgotten
 * at the eighth. It matters more here than anywhere else, because what these procedures grant is
 * access to every course and every student's grade — the one privilege that cannot be scoped to a
 * cohort and undone by removing somebody from it.
 *
 * Not the same shape as `instructorProcedure`, which admits admins *as well*. This admits nobody
 * else: an instructor deciding who else becomes an instructor is the escalation this exists to
 * prevent.
 */
export const adminProcedure = requireRole("ADMIN");
