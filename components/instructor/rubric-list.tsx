"use client";

import { Plus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { newRubricHref, newRuleSetHref, rubricHref, ruleSetHref } from "@/lib/links";
import { formatDate } from "@/lib/status";
import type { RouterOutputs } from "@/trpc/types";

type Rubrics = RouterOutputs["rubrics"]["list"];
type RuleSets = RouterOutputs["rubrics"]["listRuleSets"];

/**
 * Every rubric and every rule set, as two lists on one screen.
 *
 * Two lists rather than two screens, because they are read together: a rubric names a rule set
 * or follows the program's, and an instructor deciding whether to write a rule set wants to see
 * what already exists. Each row is a link to its form; the form says whether the reader may edit.
 */
export function RubricList({ rubrics, ruleSets }: { rubrics: Rubrics; ruleSets: RuleSets }) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Rubrics</h2>
            <p className="text-sm text-muted-foreground">
              What a submission is scored against. An assignment names one per section.
            </p>
          </div>
          <Button size="sm" variant="outline" render={<Link href={newRubricHref()} />}>
            <Plus data-icon="inline-start" />
            New rubric
          </Button>
        </div>
        {rubrics.length === 0 ? (
          <Empty>No rubrics yet.</Empty>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rubrics.map((rubric) => (
              <Row
                key={rubric.id}
                href={rubricHref(rubric.id)}
                name={rubric.name}
                detail={[
                  rubric.version === null ? "no version yet" : `v${rubric.version}`,
                  rubric.author ? `by ${rubric.author}` : "the program's",
                  rubric.ruleSetName ? `rules: ${rubric.ruleSetName}` : "the program's rules",
                  `updated ${formatDate(rubric.updatedAt)}`,
                ]}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Rule sets</h2>
            <p className="text-sm text-muted-foreground">
              The voice of a report: tone, layout, the labels on its bullets. A program follows one;
              a rubric can name its own.
            </p>
          </div>
          <Button size="sm" variant="outline" render={<Link href={newRuleSetHref()} />}>
            <Plus data-icon="inline-start" />
            New rule set
          </Button>
        </div>
        {ruleSets.length === 0 ? (
          <Empty>No rule sets yet.</Empty>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {ruleSets.map((ruleSet) => (
              <Row
                key={ruleSet.id}
                href={ruleSetHref(ruleSet.id)}
                name={ruleSet.name}
                detail={[
                  ruleSet.version === null ? "no version yet" : `v${ruleSet.version}`,
                  ruleSet.author ? `by ${ruleSet.author}` : "the program's",
                  `updated ${formatDate(ruleSet.updatedAt)}`,
                ]}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ href, name, detail }: { href: string; name: string; detail: string[] }) {
  return (
    <li>
      <Link
        href={href}
        className="flex flex-col gap-0.5 px-4 py-3 hover:bg-muted/40 sm:flex-row sm:items-baseline sm:justify-between"
      >
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">{detail.join(" · ")}</span>
      </Link>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
