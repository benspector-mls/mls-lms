import {
  MAX_COHORT_SLUG,
  MAX_TEAM_SLUG,
  slugify,
  slugifyCohort,
  teamSlug,
} from "@/lib/courses/cohort-slug";

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

describe("slugifyCohort", () => {
  it("is slugify at the cohort's own maximum", () => {
    const long = "software engineering fellowship autumn twenty twenty six";
    expect(slugifyCohort(long)).toBe(slugify(long, MAX_COHORT_SLUG));
    expect(slugifyCohort(long).length).toBeLessThanOrEqual(MAX_COHORT_SLUG);
  });

  it("turns a term into the slug a repository name carries", () => {
    expect(slugifyCohort("Fall 2026")).toBe("fall-2026");
  });
});

describe("teamSlug", () => {
  it("names the team, so every member's pushes go to a repository named after all of them", () => {
    expect(teamSlug("Team 3")).toBe("team-3");
  });

  it("is cut shorter than a cohort's slug", () => {
    // Cheaper than the 39 characters reserved for a login, which is what makes any cohort and
    // assignment pairing that fits an individual repository name fit a team's too.
    expect(MAX_TEAM_SLUG).toBeLessThan(MAX_COHORT_SLUG);
    expect(teamSlug("The Extremely Enthusiastic Otters").length).toBeLessThanOrEqual(MAX_TEAM_SLUG);
  });

  it("returns an empty string for a name it cannot transliterate", () => {
    // Refused at authoring time rather than turned into a repository nobody can predict.
    expect(teamSlug("日本語")).toBe("");
  });
});
