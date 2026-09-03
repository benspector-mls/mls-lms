/**
 * The shape check that guards a redirect path.
 *
 * Leaving a test student's view builds `/instructor/courses/{id}/settings` from a cookie, and a
 * cookie is a value somebody can set. Each string below is one somebody would try. `resolveViewAs`
 * asks the same question of the other cookie before it queries anything, so a value that is not a
 * uuid is refused without a read.
 *
 * These came out of `scripts/verify-test-student.ts`, where they needed no database at all. What
 * `resolveViewAs` itself decides — who may be answered as whom — is in
 * `tests/integration/test-student.test.ts`, because it reads two profiles to decide it.
 */
import { isUuid } from "@/lib/auth/view-as";

describe("what may be interpolated into a redirect path", () => {
  it("a uuid is a uuid", () => {
    expect(isUuid("b549d23b-76ac-41a8-ba40-13f3249d3c63")).toBe(true);
  });

  it("a traversal is not", () => {
    expect(isUuid("../../../evil")).toBe(false);
  });

  it("nor is a protocol-relative host", () => {
    expect(isUuid("//evil.example")).toBe(false);
  });

  it("nor is a uuid with a path stuck to it", () => {
    expect(isUuid("b549d23b-76ac-41a8-ba40-13f3249d3c63/x")).toBe(false);
  });

  it("nor is the empty string", () => {
    expect(isUuid("")).toBe(false);
  });
});
