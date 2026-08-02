import 'server-only'; // <-- ensure this file cannot be imported from the client

import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { cache } from 'react';
import { createTRPCContext } from './init';
import { makeQueryClient } from './query-client';
import { appRouter } from './routers/_app';

// IMPORTANT: Create a stable getter for the query client that
//            will return the same client during the same request.
export const getQueryClient = cache(makeQueryClient);

/**
 * Server-side caller. Passing `router` + `ctx` (rather than a `client`) means
 * procedures are invoked directly in this process — no HTTP and no
 * serialization, so a Date stays a real Date on this path.
 *
 * The scaffold's "if your router is on a separate server" example was removed
 * here: it was unreferenced, pointed at a placeholder URL, and stopped
 * typechecking once a transformer was declared on the router — tRPC requires a
 * transformer on every link when the router has one.
 */
export const trpc = createTRPCOptionsProxy({
  ctx: createTRPCContext,
  router: appRouter,
  queryClient: getQueryClient,
});
