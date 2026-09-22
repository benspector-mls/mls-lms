import { serveFeed } from "@/lib/integrations/salesforce/feed";

/**
 * The three refusals, which need no database: they are decided before any query runs. The order
 * they are checked in is part of what is asserted — an unknown collection must not be
 * distinguishable from a known one to a caller without the token.
 */

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const URL_BASE = "https://lms.example.test/api/integrations/salesforce";

function request(path: string, authorization?: string): Request {
  return new Request(`${URL_BASE}/${path}`, {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("serveFeed refusals", () => {
  const previous = process.env.SALESFORCE_FEED_TOKEN;

  beforeEach(() => {
    process.env.SALESFORCE_FEED_TOKEN = TOKEN;
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.SALESFORCE_FEED_TOKEN;
    else process.env.SALESFORCE_FEED_TOKEN = previous;
  });

  it("is 401 without a token, with a wrong one, and when none is configured", async () => {
    expect((await serveFeed(request("programs"), "programs")).status).toBe(401);
    expect((await serveFeed(request("programs", "Bearer nope"), "programs")).status).toBe(401);

    delete process.env.SALESFORCE_FEED_TOKEN;
    expect((await serveFeed(request("programs", `Bearer ${TOKEN}`), "programs")).status).toBe(401);
  });

  it("is 401 rather than 404 for an unknown collection without the token", async () => {
    expect((await serveFeed(request("contacts"), "contacts")).status).toBe(401);
  });

  it("is 404 for an unknown collection with the token", async () => {
    const response = await serveFeed(request("contacts", `Bearer ${TOKEN}`), "contacts");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found\n");
  });

  it("is 400 for after without since", async () => {
    const response = await serveFeed(request("programs?after=b", `Bearer ${TOKEN}`), "programs");
    expect(response.status).toBe(400);
  });
});
