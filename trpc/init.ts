import { initTRPC, TRPCError } from '@trpc/server';
import { cache } from 'react';
import superjson from 'superjson';

import { db } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';

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

  return { db, user };
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
      code: 'UNAUTHORIZED',
      message: 'You must be signed in to do that.',
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
      code: 'INTERNAL_SERVER_ERROR',
      message:
        'Your account has no profile record. This should not happen — please report it.',
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
function requireRole(...roles: Array<'STUDENT' | 'INSTRUCTOR' | 'ADMIN'>) {
  return profileProcedure.use(async ({ ctx, next }) => {
    if (!roles.includes(ctx.profile.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `This action requires one of these roles: ${roles.join(', ')}.`,
      });
    }
    return next({ ctx });
  });
}

/** Students only. Admins are deliberately excluded: accepting an assignment
 *  creates a repository named after the caller's GitHub login, which only makes
 *  sense for an actual student. */
export const studentProcedure = requireRole('STUDENT');

/** Instructors and admins. */
export const instructorProcedure = requireRole('INSTRUCTOR', 'ADMIN');
