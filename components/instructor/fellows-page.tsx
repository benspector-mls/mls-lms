import type { ReactNode } from "react";

import { CohortPicker } from "@/components/instructor/cohort-picker";
import { LinkTabs } from "@/components/link-tabs";
import { PageHeader } from "@/components/page-header";
import { FELLOWS_TABS, fellowsHref, type FellowsTab } from "@/lib/links";
import type { CohortChoice } from "@/lib/programs/cohorts";

const TAB_LABEL: Record<FellowsTab, string> = {
  roster: "Roster",
  performance: "Performance",
  coaching: "Coaching",
  trends: "Trends",
};

/**
 * The frame every tab of the Fellows screen renders inside: the title, the cohort picker, and the
 * tab strip, with the open tab's content beneath.
 *
 * **Each tab is a page, and this is what they share.** The picker in the header narrows every tab,
 * so an instructor who works with fifteen fellows reads their fifteen whichever tab is open. The
 * tab links carry the chosen cohort with them, so switching tabs keeps the filter and a link
 * somebody shares carries its filter too. The Performance tab's own course filter is not carried,
 * because it narrows only that tab.
 *
 * **The description is the page's, not the frame's.** The roster counts enrollments and the
 * Performance tab counts the fellows in its payload, so each page says what it is a count of.
 */
export function FellowsPage({
  programId,
  cohorts,
  cohortParam,
  description,
  active,
  children,
}: {
  programId: string;
  /** The options, the counts, and the selection this screen was built for, from `resolveCohort`. */
  cohorts: CohortChoice;
  /** The `?cohort=` value as it stands in the address, carried onto every tab link. */
  cohortParam: string | undefined;
  description: string;
  active: FellowsTab;
  children: ReactNode;
}) {
  const query = cohortParam ? `?cohort=${encodeURIComponent(cohortParam)}` : "";

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Fellows"
        description={description}
        actions={<CohortPicker choice={cohorts} />}
      />
      <div className="flex flex-col gap-4">
        <LinkTabs
          active={active}
          tabs={FELLOWS_TABS.map((tab) => ({
            value: tab,
            label: TAB_LABEL[tab],
            href: `${fellowsHref(programId, tab)}${query}`,
          }))}
        />
        {children}
      </div>
    </div>
  );
}
