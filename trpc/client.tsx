"use client";

// ^-- to make sure we can mount the Provider from a server component
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState } from "react";
import superjson from "superjson";
import { makeQueryClient } from "./query-client";
import type { AppRouter } from "./routers/_app";

/**
 * `useTRPCClient` alongside `useTRPC`, for the callers that need to *call* a procedure rather
 * than describe one to React Query.
 *
 * `useTRPC` builds options objects, which is what every screen wants: one mutation, one hook,
 * one pending flag. A batch is the exception — it runs a procedure a variable number of times
 * and keeps its own tally — and there is no way to hold N `useMutation` hooks for a list whose
 * length is only known at runtime. That caller wants the client itself.
 */
export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

let browserQueryClient: QueryClient;
function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return makeQueryClient();
  }
  // Browser: make a new query client if we don't already have one
  // This is very important, so we don't re-make a new client if React
  // suspends during the initial render. This may not be needed if we
  // have a suspense boundary BELOW the creation of the query client
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

function getUrl() {
  const base = (() => {
    if (typeof window !== "undefined") return "";
    if (process.env.APP_URL) return process.env.APP_URL;
    return "http://localhost:3000";
  })();
  return `${base}/api/trpc`;
}

export function TRPCReactProvider(
  props: Readonly<{
    children: React.ReactNode;
  }>,
) {
  // NOTE: Avoid useState when initializing the query client if you don't
  //       have a suspense boundary between this and the code that may
  //       suspend because React will throw away the client on the initial
  //       render if it suspends and there is no boundary
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        /*
          **Queries are batched into one request; mutations are not.**

          Batching exists to collapse the several small queries a screen makes on load into a
          single round trip, which is worth having. Applied to mutations it does the opposite of
          its job: `httpBatchLink` combines calls made in the same tick into *one* HTTP request,
          so N mutations fired together share one function invocation — and therefore one
          timeout, one failure, and one response that arrives only when the slowest of them is
          done.

          That is fatal for anything that fans out. Generating reports for a queue calls
          `gradingDrafts.generate` several times at once, each taking up to two minutes against a
          300-second function limit; batched, six of them are one request that cannot possibly
          finish, and the whole batch fails together. Unbatched, each is its own invocation with
          its own two minutes, which is what makes "one invocation per submission" true rather
          than aspirational.

          The rule is worth stating generally rather than special-casing one procedure: a query
          is one of many a screen needs and nobody waits for individually, and a mutation is a
          deliberate act whose failure and duration belong to it alone. Nothing in this
          application fires many mutations at once expecting them to share a trip.
        */
        splitLink({
          condition: (op) => op.type === "mutation",
          // Must be the same transformer as initTRPC.create() in init.ts — if these two
          // disagree you get decode failures, not a clean error. Both links carry it.
          true: httpLink({ transformer: superjson, url: getUrl() }),
          false: httpBatchLink({ transformer: superjson, url: getUrl() }),
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {props.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
