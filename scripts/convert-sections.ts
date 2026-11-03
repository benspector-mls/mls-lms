/**
 * Rewrites every assignment's section declaration into the current shape: one section per scored
 * unit, each with a key and a label, and reports every assignment it leaves alone and why.
 *
 *   npm run convert:sections                       # says what it would change, and changes nothing
 *   npm run convert:sections -- --apply            # changes
 *   npm run convert:sections:deployment            # the same, against the deployment's project
 *   npm run convert:sections:deployment -- --apply
 *
 * **One run, once, before `convert:rounds`.** The rounds script matches a round's rows to the
 * declaration this writes, so the declaration goes first.
 *
 * **What changes.** A section that already carries a key is left as it is, except that a test
 * pattern it still holds is resolved to the template's tests it matches, which become the
 * section's chosen tests, and the pattern is dropped. A hand-graded section gains a key and
 * keeps its label. A `short_response` section worth the questions and the writing together
 * becomes one section per question and, where none is declared, one Writing Quality section
 * worth what the round's writing row or the template's proposal says; a coding section worth the
 * whole exercise set becomes one per exercise, each taking its label and points from the rows of the most recent approved round
 * of any submission of the assignment, or from the template repository when no round exists. A
 * `short_response_writing` section gains a key and the label "Writing Quality". Every new section
 * is untagged: no script writes a skill, because the tag is a judgment an instructor makes.
 *
 * **What is refused rather than guessed.** A section whose rows sum to a different total than it
 * is worth; a section with no round and a template that proposes nothing for its type; a template
 * that cannot be read, including for a section whose pattern needs resolving. A pattern that
 * matches none of the template's tests is dropped and said. Such an assignment is printed with the reason and left as it stands, and the
 * form writes keys onto it the next time an instructor saves it.
 */
import { config as loadEnv } from "dotenv";

import { newSectionKey, normalizedLabel, readSections } from "../lib/assignments/spec";
import { proposeSections, type ProposedSection } from "../lib/assignments/propose-sections";
import { readReportRows, type ReportRow } from "../lib/grade/report-text";
import {
  testDisplay,
  testsInFile,
  type DeclaredTest,
  type TemplateTest,
} from "../lib/assignments/test-names";
import { isSectionType, SECTION_TYPE_REGISTRY } from "../lib/section-types";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

type Entry = Record<string, unknown>;

/** An old pattern compiled as the pipeline compiled it, or null for one that is not valid. */
function compiled(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

type Outcome = { ok: true; sections: Entry[]; changes: string[] } | { ok: false; reason: string };

/** One unit a legacy section becomes: its label, heading and points, from a row or a proposal. */
type Unit = { label: string; heading: string | null; pointValue: number; tests?: DeclaredTest[] };

/**
 * A legacy section's units from the rows of a round that graded it: one per row, labelled and
 * worth what the row was. A short response's writing row is left out, since the writing section
 * is declared on its own.
 */
function unitsFromRows(rows: ReportRow[]): Unit[] {
  return rows
    .filter((row) => !row.criterion.toLowerCase().includes("writing"))
    .map((row) => ({ label: row.label, heading: row.group, pointValue: row.scorePossible }));
}

function unitsFromProposal(type: string, proposed: ProposedSection[]): Unit[] {
  return proposed
    .filter((section) => section.type === type)
    .map((section) => ({
      label: section.label,
      heading: section.heading ?? null,
      pointValue: section.pointValue,
      ...(section.tests && section.tests.length > 0 ? { tests: section.tests } : {}),
    }));
}

/**
 * The new declaration for one assignment, or the reason it is left alone.
 *
 * Pure, so it can be checked without a database: the rows, the proposal and the template's
 * tests are handed in.
 */
export function convertDeclaration(
  sections: unknown,
  rowsByType: ReadonlyMap<string, ReportRow[]>,
  proposal: ProposedSection[] | null,
  templateTests: TemplateTest[] | null,
): Outcome {
  const entries = readSections(sections);
  const next: Entry[] = [];
  const changes: string[] = [];

  for (const entry of entries) {
    if (typeof entry.key === "string" && entry.key !== "") {
      if (typeof entry.testNamePattern !== "string" || entry.testNamePattern === "") {
        next.push(entry);
        continue;
      }
      if (templateTests === null) {
        return {
          ok: false,
          reason: `"${entry.label}" has a test pattern and the template could not be read`,
        };
      }
      const pattern = compiled(entry.testNamePattern);
      if (pattern === null) {
        return {
          ok: false,
          reason: `"${entry.label}" has a test pattern that is not a valid regular expression (${entry.testNamePattern})`,
        };
      }
      const matched = templateTests.filter((test) =>
        pattern.test(`${test.suite ?? ""} ${test.name}`),
      );
      const resolved: Entry = { ...entry };
      delete resolved.testNamePattern;
      if (matched.length > 0) {
        resolved.tests = matched.map(({ suite, name }) => ({ suite, name }));
        changes.push(
          `"${entry.label}": its test pattern becomes ${matched.length} chosen test(s) ` +
            `(${matched.map(testDisplay).join(", ")})`,
        );
      } else {
        changes.push(
          `"${entry.label}": its test pattern matched none of the template's tests and was dropped`,
        );
      }
      next.push(resolved);
      continue;
    }

    if (entry.grading === "manual") {
      const label = typeof entry.label === "string" ? entry.label : "";
      if (label === "") return { ok: false, reason: "a hand-graded section has no label" };
      next.push({ ...entry, key: newSectionKey() });
      changes.push(`"${label}" gains a key`);
      continue;
    }

    const type = typeof entry.type === "string" ? entry.type : "";
    const pointValue = typeof entry.pointValue === "number" ? entry.pointValue : null;
    if (!isSectionType(type) || pointValue === null) {
      return { ok: false, reason: `a section has no known type or no point value (${type})` };
    }

    if (type === "short_response_writing") {
      next.push({ ...entry, key: newSectionKey(), label: SECTION_TYPE_REGISTRY[type].label });
      changes.push(`the writing section gains a key`);
      continue;
    }

    const fromRows = rowsByType.get(type);
    const units =
      fromRows && fromRows.length > 0
        ? unitsFromRows(fromRows)
        : proposal
          ? unitsFromProposal(type, proposal)
          : [];
    const source = fromRows && fromRows.length > 0 ? "the latest approved round" : "the template";
    /*
      Units read from a round's rows carry no tests of their own. Where the template was read,
      each takes the tests the proposal chose for the exercise of the same label, which is what
      the section's old pattern was standing in for across all of them.
    */
    if (proposal && fromRows && fromRows.length > 0) {
      for (const unit of units) {
        const proposed = proposal.find(
          (section) =>
            section.type === type && normalizedLabel(section.label) === normalizedLabel(unit.label),
        );
        if (proposed?.tests && proposed.tests.length > 0) unit.tests = proposed.tests;
      }
    }
    const hadPattern = typeof entry.testNamePattern === "string" && entry.testNamePattern !== "";
    /*
      An exercise the template could not name tests for keeps what the pattern gave the whole
      section: the tests the pattern matches, as it matched them. Wider than its own tests would
      be, and exactly as wide as before, where "no tests" would now mean the whole suite.
    */
    if (hadPattern && templateTests !== null) {
      const pattern = compiled(String(entry.testNamePattern));
      if (pattern === null) {
        return {
          ok: false,
          reason: `the ${type} section has a test pattern that is not a valid regular expression (${String(entry.testNamePattern)})`,
        };
      }
      const narrowed = templateTests
        .filter((test) => pattern.test(`${test.suite ?? ""} ${test.name}`))
        .map(({ suite, name }) => ({ suite, name }));
      if (narrowed.length > 0) {
        for (const unit of units) {
          if (!unit.tests || unit.tests.length === 0) unit.tests = narrowed;
        }
      }
    }
    if (units.length === 0) {
      return {
        ok: false,
        reason: `the ${type} section has no approved round with rows and the template proposes nothing for it`,
      };
    }

    /*
      A short response declared before the split was worth its questions and its writing score
      together, and the writing score has no section of its own yet. The writing row of the
      round, or the writing section of the proposal, says what it is worth; the Writing Quality
      section is added after the questions, and the total has to come out to the old worth.
    */
    let writing: number | null = null;
    if (type === "short_response" && !entries.some((e) => e.type === "short_response_writing")) {
      writing =
        fromRows && fromRows.length > 0
          ? (fromRows.find((row) => row.criterion.toLowerCase().includes("writing"))
              ?.scorePossible ?? null)
          : (proposal?.find((section) => section.type === "short_response_writing")?.pointValue ??
            null);
    }
    const total = units.reduce((sum, unit) => sum + unit.pointValue, 0) + (writing ?? 0);
    if (Math.abs(total - pointValue) > 0.001) {
      return {
        ok: false,
        reason:
          `the ${type} section is worth ${pointValue} but its ${units.length} units from ` +
          `${source}${writing !== null ? ` and a writing score of ${writing}` : ""} sum to ${total}`,
      };
    }
    for (const unit of units) {
      const section: Entry = {
        ...entry,
        key: newSectionKey(),
        label: unit.label,
        pointValue: unit.pointValue,
      };
      delete section.heading;
      delete section.testNamePattern;
      delete section.tests;
      if (unit.heading) section.heading = unit.heading;
      if (unit.tests && unit.tests.length > 0) section.tests = unit.tests;
      next.push(section);
    }
    if (writing !== null) {
      const section: Entry = {
        ...entry,
        key: newSectionKey(),
        type: "short_response_writing",
        label: SECTION_TYPE_REGISTRY.short_response_writing.label,
        pointValue: writing,
      };
      delete section.heading;
      delete section.testNamePattern;
      delete section.tests;
      next.push(section);
    }
    changes.push(
      `the ${type} section becomes ${units.length} sections from ${source}` +
        (writing !== null ? ` and a Writing Quality section worth ${writing}` : "") +
        (hadPattern
          ? units.some((unit) => unit.tests && unit.tests.length > 0)
            ? "; its test pattern is replaced by chosen tests on each exercise"
            : "; its test pattern is dropped, since it matched none of the template's tests"
          : ""),
    );
  }

  return { ok: true, sections: next, changes };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { db } = await import("../lib/prisma");
  const { readTemplateForProposal } = await import("../lib/assignments/template-contents");
  const { isGithubAppConfigured } = await import("../lib/github/app-client");

  const assignments = await db.assignment.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      sections: true,
      templateRepo: true,
      templateRef: true,
      runnerPreset: true,
      course: { select: { name: true } },
    },
  });

  let changed = 0;
  let untouched = 0;
  const refused: string[] = [];

  for (const assignment of assignments) {
    const entries = readSections(assignment.sections);
    const hasPattern = (entry: Entry) =>
      typeof entry.testNamePattern === "string" && entry.testNamePattern !== "";
    if (
      entries.every(
        (entry) => typeof entry.key === "string" && entry.key !== "" && !hasPattern(entry),
      )
    ) {
      untouched += 1;
      continue;
    }

    /*
      The rows of the most recent approved round of any submission of this assignment, by section
      type: what the model found the work's structure to be, which is the best reading of the
      assignment's units there is.
    */
    const latest = await db.gradingDraft.findFirst({
      where: { submission: { assignmentId: assignment.id }, status: "APPROVED" },
      orderBy: { approvedAt: "desc" },
      select: { sections: { select: { sectionType: true, rubricItems: true } } },
    });
    const rowsByType = new Map<string, ReportRow[]>();
    for (const section of latest?.sections ?? []) {
      rowsByType.set(section.sectionType, readReportRows(section.rubricItems));
    }

    // The template, read only when a legacy model-graded section has no rows to read from, or
    // when a section still holds a test pattern to resolve against the suite.
    const needsTemplate = entries.some(
      (entry) =>
        hasPattern(entry) ||
        (entry.grading !== "manual" &&
          !(typeof entry.key === "string" && entry.key !== "") &&
          entry.type !== "short_response_writing" &&
          (rowsByType.get(String(entry.type)) ?? []).length === 0),
    );
    let proposal: ProposedSection[] | null = null;
    let templateTests: TemplateTest[] | null = null;
    if (needsTemplate && assignment.templateRepo && isGithubAppConfigured()) {
      try {
        const template = await readTemplateForProposal({
          templateRepo: assignment.templateRepo,
          templateRef: assignment.templateRef,
          hasRunner: assignment.runnerPreset !== "none",
        });
        proposal = proposeSections(template, newSectionKey).sections;
        templateTests = template.tests.flatMap((file) => testsInFile(file.path, file.content));
      } catch (err) {
        refused.push(
          `${assignment.course.name} › ${assignment.title}: the template could not be read ` +
            `(${err instanceof Error ? err.message : String(err)})`,
        );
        continue;
      }
    }

    const outcome = convertDeclaration(assignment.sections, rowsByType, proposal, templateTests);
    if (!outcome.ok) {
      refused.push(`${assignment.course.name} › ${assignment.title}: ${outcome.reason}`);
      continue;
    }

    console.log(`${assignment.course.name} › ${assignment.title}`);
    for (const change of outcome.changes) console.log(`  - ${change}`);
    if (apply) {
      await db.assignment.update({
        where: { id: assignment.id },
        data: { sections: outcome.sections as never },
      });
    }
    changed += 1;
  }

  console.log("");
  console.log(
    `${apply ? "Converted" : "Would convert"} ${changed} assignment(s); ${untouched} already in ` +
      `the current shape; ${refused.length} left alone.`,
  );
  for (const line of refused) console.log(`  ! ${line}`);
  if (!apply && changed > 0) console.log("\nRun again with --apply to write these.");

  await db.$disconnect();
}

if (process.argv[1] && /convert-sections\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
