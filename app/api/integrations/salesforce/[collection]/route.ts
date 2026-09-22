import { serveFeed } from "@/lib/integrations/salesforce/feed";

/**
 * The Salesforce feed. Everything is in `lib/integrations/salesforce/feed.ts`; this file exists
 * because Next.js needs one here. `cacheComponents` is enabled, so `params` is a promise.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ collection: string }> },
): Promise<Response> {
  const { collection } = await params;
  return serveFeed(request, collection);
}
