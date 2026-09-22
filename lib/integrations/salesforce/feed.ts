import "server-only";

import { db } from "@/lib/prisma";

import { COLLECTIONS, isCollectionName } from "./collections";
import { isFeedQueryError, parseFeedQuery } from "./cursor";
import { bearerTokenMatches } from "./token";

/**
 * One request to the Salesforce feed, from token to envelope.
 *
 * **Why a route handler and not a procedure.** Make.com calls this from its own servers on its
 * own schedule. It sends no cookie, it speaks no tRPC, and superjson's `{json, meta}` envelope is
 * one more thing it would have to unwrap. The calendar feed is a route for the same reasons.
 *
 * It is reachable without a session because `lib/supabase/proxy.ts` excludes `/api` from the
 * sign-in redirect for the GitHub webhook's sake, so a request with no cookie arrives here rather
 * than being answered with an HTML login page that Make would try to parse as JSON.
 *
 * **The token is checked before the collection name.** A 404 answered to a caller without the
 * token would tell them which names exist; every request without the token gets the same 401.
 *
 * **Refusals are one terse line.** There is nobody on the other end who would read a helpful
 * message — Make shows its operator a status code — and a message explaining which part was
 * wrong is a message that helps somebody probe the endpoint.
 *
 * **No rate limit.** A request runs one or two queries over small tables and returns at most 500
 * records. `lib/audit/rate-limit.ts` guards the operations that spend money at Anthropic and E2B;
 * this one spends a query.
 */
export async function serveFeed(request: Request, collection: string): Promise<Response> {
  const expected = process.env.SALESFORCE_FEED_TOKEN ?? "";
  if (!bearerTokenMatches(request.headers.get("authorization"), expected)) {
    return terse(401, "Unauthorized");
  }

  if (!isCollectionName(collection)) return terse(404, "Not found");

  const query = parseFeedQuery(new URL(request.url).searchParams);
  if (isFeedQueryError(query)) return terse(400, query.error);

  const page = await COLLECTIONS[collection](db, query);

  /*
    No caching anywhere. Make polls on its own schedule and there is no load to relieve, and a
    cached page would only add to the delay before a change reaches Salesforce.
  */
  return Response.json(page, { headers: { "Cache-Control": "no-store" } });
}

function terse(status: number, body: string): Response {
  return new Response(`${body}\n`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
