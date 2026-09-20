import Link from "next/link";
import { BarChart3 } from "lucide-react";

import { GcfTab } from "@/components/instructor/gcf-tab";
import { GradebookGrid } from "@/components/instructor/gradebook-grid";
import { Overview } from "@/components/instructor/gradebook-overview";
import { EmptyState } from "@/components/list-states";
import { CATEGORY_META, UNIT_CATEGORIES } from "@/lib/course-units";
import { groupByUnit, workOf } from "@/lib/gradebook/categories";
import { gradebookIsEmpty, sortGradebookAssignments } from "@/lib/gradebook/csv";
import { gradebookHref } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Every student against every piece of work, in five tabs.
 *
 * **Modules, projects, and assessments are read separately**, which is what the tabs are for:
 * "how is this student doing" has three answers, and one undifferentiated grid gives an average of
 * them that describes none. Overview puts the three figures in one row so a reader who wants the
 * comparison does not have to hold three tabs in their head.
 *
 * The split is `groupByUnit` in `lib/gradebook/categories.ts`, and it is exhaustive: every
 * assignment in the payload appears under exactly one unit, on exactly one tab. A column that is
 * missing looks like work that does not exist, which is the one failure a tabbed gradebook can
 * have that an untabbed one cannot.
 *
 * **The tab lives in the address rather than in component state**, which is what keeps this a
 * server component. The alternative renders all four tabs and ships a term of grading cells to
 * every reader's browser to draw one of them — the same weight the CSV download is deliberately
 * built on the server to avoid. It also makes a tab shareable, and it is the pattern the group
 * filter beside it already uses.
 *
 * The grid on each category tab *is* a client component, because searching and sorting it are
 * things a reader does dozens of times a minute and a round trip per keystroke is not a control.
 * It receives one category's work, so three tabs' worth stays on the server.
 *
 * **The fifth tab is not coursework.** The General Coding Framework is sat at CodeSignal, outside
 * this application: there is no assignment behind a score and nothing was handed in. It is here
 * because this is where a cohort is read, and nowhere else — it takes no part in the completion
 * roll-up, since a course whose units are all finished is finished whether or not anybody has sat
 * an external benchmark yet.
 */

type Gradebook = RouterOutputs["courses"]["gradebook"];
type Gcf = RouterOutputs["gcf"]["forCourse"];

/**
 * The five tabs, in the order they are offered.
 *
 * Overview first because it is the one that answers a question about the whole cohort; then the
 * three categories in the order `UNIT_CATEGORIES` names them, so the tab strip and every other
 * list of the categories in the application read the same way round; and the GCF last, because it
 * is the one thing here that is not this course's own work.
 */
export const GRADEBOOK_TABS = ["overview", ...UNIT_CATEGORIES, "GCF"] as const;

export type GradebookTab = (typeof GRADEBOOK_TABS)[number];

/**
 * What each tab is called.
 *
 * A map of its own rather than `CATEGORY_META[tab].tabLabel`, which is what this was and which
 * only worked while every tab but the overview was a `CourseUnitCategory`. The GCF is not one —
 * it is not coursework at all — so the lookup had to become something that covers all five.
 */
const TAB_LABEL: Record<GradebookTab, string> = {
  overview: "Overview",
  MODULE: CATEGORY_META.MODULE.tabLabel,
  PROJECT: CATEGORY_META.PROJECT.tabLabel,
  ASSESSMENT: CATEGORY_META.ASSESSMENT.tabLabel,
  GCF: "GCF",
};

/**
 * Which tab an address names, defaulting to the overview.
 *
 * Exported so the page can parse `?tab=` and pass the answer down, in the manner of
 * `parseCohortSelection`. Anything unrecognised is the overview rather than an error: a stale
 * link or a typed address should land somewhere useful, and the overview is the tab that
 * describes all three of the others.
 */
export function parseGradebookTab(value: string | undefined): GradebookTab {
  return (GRADEBOOK_TABS as readonly string[]).includes(value ?? "")
    ? (value as GradebookTab)
    : "overview";
}

export function Gradebook({
  data,
  gcf,
  tab,
  cohort,
  now,
}: {
  data: Gradebook;
  /**
   * The selected fellows' GCF results, or null on a tab that does not read them.
   *
   * Fetched by the page only for the two tabs that show them, so opening the Assignments tab does
   * not also pull a term of CodeSignal results nobody asked for.
   */
  gcf: Gcf | null;
  tab: GradebookTab;
  /** The cohort the grid was built for, carried into every tab link. */
  cohort: string;
  /**
   * The page's one clock read, as an ISO string. Handed down rather than read here so the grid,
   * the browser that hydrates it, and the CSV built beside it all mean the same instant by "now" —
   * a deadline can never have passed in the file and not on the screen, or the reverse.
   */
  now: string;
}) {
  const active = data.activeEnrollments.map((enrollment) => enrollment.student);
  const removed = data.removedEnrollments.map((enrollment) => enrollment.student);

  /*
    Course order, which is `courseUnit.position` — the sequence an instructor set, not anything
    alphabetical or parsed out of a name. Shared with the CSV export rather than sorted here, so
    the columns of the downloaded file are these columns in this order.
  */
  const assignments = sortGradebookAssignments(data.assignments);

  /*
    The three lists the tabs draw, from the payload this render already holds. Sorting first and
    grouping second, so the units keep course order and each unit's work is re-sorted by due date
    on top of it.
  */
  const grouped = groupByUnit(assignments, data.courseUnits);

  if (gradebookIsEmpty(data)) {
    return (
      <EmptyState
        icon={<BarChart3 />}
        title="Nothing to show yet"
        description="Grades appear here once the course has assignments and students have joined."
      />
    );
  }

  /*
    Assignments, not units. The count is there to say how much is on the other side of a tab, and
    what a tab holds is columns — "18 modules" tells a reader nothing about whether opening it
    means reading four columns or ninety. Counting units also made the Assignments tab and the
    Projects tab measure different-sized things while looking like one scale.

    Every assignment in the category, which is every released one — the gradebook payload holds no
    drafts — because the grid draws a column for each. Units with nothing in them contribute
    nothing here, which is the same reason the grid omits their bands.
  */
  const counts: Record<GradebookTab, number | null> = {
    overview: null,
    MODULE: workOf(grouped.MODULE).length,
    PROJECT: workOf(grouped.PROJECT).length,
    ASSESSMENT: workOf(grouped.ASSESSMENT).length,
    // Sittings rather than students, which is the same reading as the other three: how much is on
    // the other side of the tab.
    GCF: gcf?.attempts.length ?? null,
  };

  return (
    <div className="flex flex-col gap-6">
      <TabStrip courseId={data.course.id} cohort={cohort} active={tab} counts={counts} />

      {tab === "overview" ? (
        <Overview
          courseId={data.course.id}
          grouped={grouped}
          active={active}
          removed={removed}
          cells={data.cells}
          removedCells={data.removedCells}
          gcf={gcf}
          now={now}
        />
      ) : tab === "GCF" ? (
        gcf === null ? null : (
          <GcfTab courseId={data.course.id} data={gcf} />
        )
      ) : (
        <GradebookGrid
          courseId={data.course.id}
          category={tab}
          units={grouped[tab]}
          active={active}
          removed={removed}
          cells={data.cells}
          removedCells={data.removedCells}
          now={now}
        />
      )}
    </div>
  );
}

/**
 * The four tabs, as links.
 *
 * Links rather than buttons, so each tab is an address: shareable, bookmarkable, and reachable
 * with the browser's own back button. The cohort filter is carried through every one of them,
 * because switching tab must never silently widen the grid back to the whole roster.
 *
 * The count beside each label is how many assignments are on the other side of it, which is what
 * makes the shape of a course readable without opening all four — "forty assignments, three
 * assessment parts, five deliverables" in a glance.
 */
function TabStrip({
  courseId,
  cohort,
  active,
  counts,
}: {
  courseId: string;
  cohort: string;
  active: GradebookTab;
  counts: Record<GradebookTab, number | null>;
}) {
  const href = (tab: GradebookTab) => {
    const params = new URLSearchParams();
    if (cohort !== "all") params.set("cohort", cohort);
    if (tab !== "overview") params.set("tab", tab);
    const query = params.toString();
    return query ? `${gradebookHref(courseId)}?${query}` : gradebookHref(courseId);
  };

  /*
    The strip scrolls sideways rather than sizing itself to its five pills. On a phone the five of
    them are wider than the screen, and the shell holds the page itself to the window's width on
    purpose — so a strip that overflowed simply had its last tab, the GCF, cut off with nothing to
    scroll and no way to reach it. Scrolling within the strip is the arrangement every wide table
    on this page already uses, and it leaves the tab reachable by keyboard either way: tabbing to a
    link scrolls it into view.
  */
  return (
    <nav
      aria-label="Gradebook categories"
      className="no-scrollbar flex max-w-full self-start items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1"
    >
      {GRADEBOOK_TABS.map((tab) => (
        <Link
          key={tab}
          href={href(tab)}
          aria-current={tab === active ? "page" : undefined}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
            tab === active
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {TAB_LABEL[tab]}
          {counts[tab] !== null && (
            <span className="text-xs tabular-nums opacity-70">{counts[tab]}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
