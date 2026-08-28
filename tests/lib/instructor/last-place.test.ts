import { viewPlaceOf } from "@/lib/instructor/last-place";

const COURSE = "11111111-1111-4111-8111-111111111111";
const PROGRAM = "77777777-7777-4777-8777-777777777777";
const ASSIGNMENT = "33333333-3333-4333-8333-333333333333";
const STUDENT = "44444444-4444-4444-8444-444444444444";

/**
 * What `/instructor` will send somebody back to, checked exhaustively for the reason
 * `sameViewInCourse` is: a view missing from either list here does not fail, it is simply never
 * remembered, and the reader is quietly returned to the screen before it instead.
 */
describe("the eight views that are remembered", () => {
  it.each(["triage", "gradebook", "curriculum", "teams", "settings"])(
    "a course's %s",
    (segment) => {
      expect(viewPlaceOf(`/instructor/courses/${COURSE}/${segment}`)).toEqual({
        scope: "courses",
        id: COURSE,
        href: `/instructor/courses/${COURSE}/${segment}`,
      });
    },
  );

  it.each(["attendance", "roster", "settings"])("a program's %s", (segment) => {
    expect(viewPlaceOf(`/instructor/programs/${PROGRAM}/${segment}`)).toEqual({
      scope: "programs",
      id: PROGRAM,
      href: `/instructor/programs/${PROGRAM}/${segment}`,
    });
  });

  /*
    The two lists are not interchangeable. A course has no roster and a program has no gradebook,
    so remembering one under the other scope would build an address for a screen that does not
    exist and send the reader to a 404 the morning after.
  */
  it.each([
    ["a course", `/instructor/courses/${COURSE}/roster`],
    ["a course", `/instructor/courses/${COURSE}/attendance`],
    ["a program", `/instructor/programs/${PROGRAM}/triage`],
    ["a program", `/instructor/programs/${PROGRAM}/gradebook`],
  ])("%s does not borrow the other scope's view", (_scope, path) => {
    expect(viewPlaceOf(path)).toBeNull();
  });
});

/**
 * Everything below the view is discarded, which is the whole of "reopen the view, not the exact
 * screen you had open".
 *
 * An assignment can be deleted between one sitting and the next, so returning somebody to its
 * grading queue would return them to a screen reporting it cannot find the thing. The list it was
 * in is still there. These are the same answers `isActiveCourseView` gives, because both are
 * asking which view a screen belongs to.
 */
describe("a deeper screen is remembered as the view it sits under", () => {
  it.each([
    ["one assignment's grading queue", `/instructor/courses/${COURSE}/curriculum/${ASSIGNMENT}`],
    ["its edit form", `/instructor/courses/${COURSE}/curriculum/${ASSIGNMENT}/edit`],
    ["the new-assignment form", `/instructor/courses/${COURSE}/curriculum/new`],
  ])("%s becomes the curriculum", (_label, path) => {
    expect(viewPlaceOf(path)?.href).toBe(`/instructor/courses/${COURSE}/curriculum`);
  });

  it("one day of attendance becomes the program's attendance", () => {
    expect(viewPlaceOf(`/instructor/programs/${PROGRAM}/attendance/day/2026-08-14`)?.href).toBe(
      `/instructor/programs/${PROGRAM}/attendance`,
    );
  });

  it("tolerates a trailing slash", () => {
    expect(viewPlaceOf(`/instructor/courses/${COURSE}/gradebook/`)?.href).toBe(
      `/instructor/courses/${COURSE}/gradebook`,
    );
  });
});

/**
 * The screens that are deliberately not remembered.
 *
 * Both fellow-record screens light no sidebar item, because each is reached from three places and
 * belongs to none of them. Recording nothing leaves the previous value standing, so clicking from
 * a course's triage into a fellow's work and closing the tab returns you to that triage.
 */
describe("addresses that record nothing", () => {
  it.each([
    ["a fellow's work in a course", `/instructor/courses/${COURSE}/students/${STUDENT}`],
    ["a fellow's record in a program", `/instructor/programs/${PROGRAM}/students/${STUDENT}`],
    ["the bare course address", `/instructor/courses/${COURSE}`],
    ["the bare program address", `/instructor/programs/${PROGRAM}`],
    ["/instructor itself, which would loop", "/instructor"],
    ["a fellow's own course", `/courses/${COURSE}`],
    ["a fellow's dashboard", "/dashboard"],
    ["the program list", "/programs"],
    ["the sign-in screen", "/auth/login"],
    ["nothing at all", ""],
  ])("%s", (_label, path) => {
    expect(viewPlaceOf(path)).toBeNull();
  });
});

/**
 * The same function reads an untrusted cookie, so a value somebody set by hand must not become a
 * path. It never echoes its input — the address it returns is built from a scope it recognised, an
 * id whose shape it checked, and a segment from its own list — and these are what say so.
 */
describe("a hostile cookie value", () => {
  it.each([
    ["another host", "//evil.example.com/instructor/courses/x/triage"],
    ["a scheme", "https://evil.example.com"],
    ["a climb out of the scope", `/instructor/courses/../../../etc/triage`],
    ["a climb in place of the id", "/instructor/courses/../triage"],
    ["an id that is not a uuid", "/instructor/courses/not-a-uuid/triage"],
    ["an id carrying a path", `/instructor/courses/${COURSE}%2F..%2F..%2Fadmin/triage`],
    ["a segment that is not a view", `/instructor/courses/${COURSE}/../../admin`],
    ["a made-up segment", `/instructor/courses/${COURSE}/exfiltrate`],
    ["a made-up scope", `/instructor/cohorts/${COURSE}/triage`],
    [
      "a query string smuggled into the segment",
      `/instructor/courses/${COURSE}/triage?next=/admin`,
    ],
  ])("%s is refused", (_label, value) => {
    expect(viewPlaceOf(value)).toBeNull();
  });

  it("builds its answer rather than echoing what it was given", () => {
    // Extra separators collapse: the address returned is assembled from three checked pieces, so
    // it comes back canonical rather than in the shape the cookie happened to be written in.
    expect(viewPlaceOf(`//instructor//courses//${COURSE}//triage//`)?.href).toBe(
      `/instructor/courses/${COURSE}/triage`,
    );
  });
});

/**
 * The contract between the two sides, which nothing else checks.
 *
 * `AppShell` writes `place.href` into the cookie and `/instructor` reads that cookie back through
 * this same function. So whatever it produces it must also accept, and produce again unchanged —
 * otherwise the shell would record a screen the redirect then refuses, and the reader would be
 * returned to a guess while a perfectly good address sat in their browser.
 */
describe("what the browser writes is what the server reads back", () => {
  it.each([
    `/instructor/courses/${COURSE}/triage`,
    `/instructor/courses/${COURSE}/gradebook`,
    `/instructor/courses/${COURSE}/curriculum/${ASSIGNMENT}/edit`,
    `/instructor/courses/${COURSE}/settings`,
    `/instructor/programs/${PROGRAM}/attendance/day/2026-08-14`,
    `/instructor/programs/${PROGRAM}/roster`,
  ])("%s survives the round trip", (pathname) => {
    const written = viewPlaceOf(pathname);
    expect(written).not.toBeNull();
    expect(viewPlaceOf(written!.href)).toEqual(written);
  });
});
