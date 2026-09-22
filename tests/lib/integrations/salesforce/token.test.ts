import { bearerTokenMatches } from "@/lib/integrations/salesforce/token";

/**
 * One caller, one secret. The cases worth writing down are the ones a naive comparison gets
 * wrong: a token of a different length must be refused *without throwing*, because
 * `timingSafeEqual` throws on unequal lengths and an exception here is a 500 that reads as an
 * outage rather than a refusal; and an empty expected value must refuse everything, because an
 * unset environment variable has to fail closed.
 */

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("bearerTokenMatches", () => {
  it("accepts the right token", () => {
    expect(bearerTokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("refuses a wrong token of the same length", () => {
    const wrong = `${TOKEN.slice(0, -1)}0`;
    expect(bearerTokenMatches(`Bearer ${wrong}`, TOKEN)).toBe(false);
  });

  it("refuses a token of a different length without throwing", () => {
    expect(() => bearerTokenMatches("Bearer short", TOKEN)).not.toThrow();
    expect(bearerTokenMatches("Bearer short", TOKEN)).toBe(false);
  });

  it("refuses a missing header, a bare token, and the wrong scheme", () => {
    expect(bearerTokenMatches(null, TOKEN)).toBe(false);
    expect(bearerTokenMatches(TOKEN, TOKEN)).toBe(false);
    expect(bearerTokenMatches(`Basic ${TOKEN}`, TOKEN)).toBe(false);
  });

  it("refuses everything when nothing is expected", () => {
    expect(bearerTokenMatches("Bearer ", "")).toBe(false);
    expect(bearerTokenMatches(`Bearer ${TOKEN}`, "")).toBe(false);
  });
});
