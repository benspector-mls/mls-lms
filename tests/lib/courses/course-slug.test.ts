import {
  courseSlugProblem,
  MAX_COURSE_SLUG,
  MAX_TEAM_SLUG,
  slugify,
  slugifyCourse,
  suggestCourseSlug,
  teamSlug,
} from "@/lib/courses/course-slug";

/**
 * The one transformation from text to something legal in a repository name.
 *
 * Two callers cut to different lengths and must agree on everything else, so what these cases
 * hold is that the *rule* is one rule — a slug of the same text differs only where it was cut.
 */
describe("slugify", () => {
  it("lowercases and collapses runs of non-alphanumerics to single hyphens", () => {
    expect(slugify("Cohort 12 (evening)", 40)).toBe("cohort-12-evening");
  });

  it("trims hyphens from both ends", () => {
    expect(slugify("  Fall 2026!  ", 40)).toBe("fall-2026");
  });

  it("cuts to the length asked for", () => {
    expect(slugify("software engineering fellowship", 8)).toBe("software");
  });

  it("does not leave a trailing hyphen behind after cutting", () => {
    // The cut can land on a hyphen, which would produce `f26--swe-1-4-loops` in a repository
    // name. Trimming again afterwards is what stops it.
    expect(slugify("software engineering", 9)).toBe("software");
  });

  it("returns nothing usable as an empty string rather than inventing a slug", () => {
    // A slug nobody chose ends up in the name of every repository a cohort creates, so the
    // caller is told there is nothing here and decides — the form leaves the field for a person.
    expect(slugify("", 40)).toBe("");
    expect(slugify("!!! ???", 40)).toBe("");
    expect(slugify("日本語", 40)).toBe("");
  });
});

describe("slugifyCourse", () => {
  it("is slugify at the cohort's own maximum", () => {
    const long = "software engineering fellowship autumn twenty twenty six";
    expect(slugifyCourse(long)).toBe(slugify(long, MAX_COURSE_SLUG));
    expect(slugifyCourse(long).length).toBeLessThanOrEqual(MAX_COURSE_SLUG);
  });

  /*
    The term as the slug a repository name carries, over the whole range of things somebody types
    into the field: two ordinary terms, a term with punctuation in it, one padded with spaces, one
    written with a slash, and the two that contain nothing usable at all.

    The last two are the pair worth reading. An empty string is the answer rather than an invented
    name, because a course's short name prefixes every repository it generates and the caller has
    to notice there is nothing here — `suggestCourseSlug` below is what decides what to do about it.
  */
  it.each([
    ["Fall 2026", "fall-2026"],
    ["Spring 2027", "spring-2027"],
    ["Cohort 12 (evening)", "cohort-12-evening"],
    ["  Fall   2026  ", "fall-2026"],
    ["FALL/2026", "fall-2026"],
    ["!!!", ""],
    ["", ""],
  ])('"%s" slugifies to "%s"', (term, expected) => {
    expect(slugifyCourse(term)).toBe(expected);
  });
});

describe("teamSlug", () => {
  it("names the team, so every member's pushes go to a repository named after all of them", () => {
    expect(teamSlug("Team 3")).toBe("team-3");
  });

  it("is cut shorter than a cohort's slug", () => {
    // Cheaper than the 39 characters reserved for a login, which is what makes any cohort and
    // assignment pairing that fits an individual repository name fit a team's too.
    expect(MAX_TEAM_SLUG).toBeLessThan(MAX_COURSE_SLUG);
    expect(teamSlug("The Extremely Enthusiastic Otters").length).toBeLessThanOrEqual(MAX_TEAM_SLUG);
  });

  it("returns an empty string for a name it cannot transliterate", () => {
    // Refused at authoring time rather than turned into a repository nobody can predict.
    expect(teamSlug("日本語")).toBe("");
  });
});

/**
 * The short name a new course is offered.
 *
 * **The course name and the term, not the term alone.** That is the whole reason this function
 * exists: every program a school runs starts in the fall, so a term-only suggestion made
 * `fall-2026` the short name of whichever course was created first and a refusal for every course
 * after it — and the instructor hitting that refusal had done nothing wrong.
 *
 * The pair that matters most is the second and third case: **one course's short name is the same
 * shape in every season**. The course half is measured against the longest a compacted term can be
 * rather than against the term in hand, so a fellowship is `fse-f26` in the autumn and `fse-sp27`
 * in the spring. Measured against the actual term it would be `software-engineering-f26` and
 * `software-sp27` — one character of season costing a word of the course name — and two years of
 * the same course would stop looking related.
 *
 * Uniqueness is still the database's. Two courses whose names abbreviate the same way collide,
 * which this cannot prevent and `courses.create` refuses in words.
 */
const SUGGESTIONS: [string, string, string][] = [
  // Short enough whole.
  ["Data Science", "Fall 2026", "data-science-f26"],
  // Too long whole, so the course becomes its initials — and stays that way across seasons.
  ["Fullstack Software Engineering", "Fall 2026", "fse-f26"],
  ["Fullstack Software Engineering", "Spring 2027", "fse-sp27"],
  ["Data Science", "Spring 2027", "data-science-sp27"],
  // A term this cannot compact keeps its full slug, and the course gives way to it.
  ["Fullstack Software Engineering", "Cohort 12 (evening)", "fse-cohort-12-evening"],
  // Seasons that share a first letter are still told apart.
  ["Data Science", "Summer 2026", "data-science-su26"],
  ["Data Science", "Winter 2026", "data-science-w26"],
  // A two-digit year, for the people who write it that way.
  ["Data Science", "Fall '26", "data-science-f26"],
  // Half a form is half a suggestion rather than none.
  ["", "Fall 2026", "f26"],
  ["Data Science", "", "data-science"],
];

describe("suggestCourseSlug", () => {
  it.each(SUGGESTIONS)('"%s" in "%s" suggests "%s"', (courseName, term, expected) => {
    expect(suggestCourseSlug({ courseName, term })).toBe(expected);
  });

  /*
    Every suggestion has to be a legal short name, which is the only property that actually
    matters — a suggestion the creation form would then reject is worse than no suggestion at all,
    because somebody has to work out what is wrong with a name they did not choose.
  */
  it.each(SUGGESTIONS)('..."%s" in "%s" is a usable short name', (courseName, term) => {
    const slug = suggestCourseSlug({ courseName, term });
    expect([slug === "", courseSlugProblem(slug)]).toEqual([false, null]);
  });
});
