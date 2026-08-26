import type * as React from "react";

/**
 * A named list of what is inside a unit — its assignments, or its resources.
 *
 * Four call sites, and they are the same three elements at every one: a section divided from what
 * is above it, an uppercase heading, and a list with rules between its rows. The instructor's
 * Curriculum screen draws one for the work in a unit and one for the readings; a student's course
 * page draws the same two. Written out four times they had already drifted — one pair of screens
 * padded the heading above by ten pixels and the other by twelve — which is the kind of difference
 * nobody sees and everybody half-notices.
 *
 * The heading is a string rather than a node because it is always a phrase, and sometimes a phrase
 * with a count in it: "Resources", "2 assignments", "3 deliverables". The word for the work comes
 * from the unit's category, through `partCount` and `CATEGORY_META`, so a project's list is not
 * called "Assignments" on one screen and "Deliverables" on the other.
 *
 * No `"use client"`, so either kind of component may render it. It holds no state and takes no
 * callback — it is a heading and a list.
 */
export function UnitList({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border">
      <h3 className="px-3 pt-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {heading}
      </h3>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}
