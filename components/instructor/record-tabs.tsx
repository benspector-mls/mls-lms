import type { ReactNode } from "react";

import { LinkTabs } from "@/components/link-tabs";
import { OutlinedPage, type OutlineSection } from "@/components/outlined-page";
import { RECORD_TABS, programStudentHref, type RecordTab } from "@/lib/links";

const TAB_LABEL: Record<RecordTab, string> = {
  performance: "Performance",
  coaching: "Coaching",
  trends: "Trends",
};

/**
 * The fellow's record as a page with an outline: the header and the tab strip above it, and an "On
 * this page" list that names the sections of the open tab.
 *
 * **Each tab is an address, and this is the frame the three pages share.** The address says which
 * tab is open, so the page that renders this knows its own sections and hands only those to the
 * outline — a tab that is not showing is not on the page, and a list naming its sections would link
 * to nothing.
 */
export function RecordTabs({
  programId,
  studentId,
  header,
  active,
  sections,
  children,
}: {
  programId: string;
  studentId: string;
  /** The page title and the identity card, above the tab strip. */
  header: ReactNode;
  active: RecordTab;
  /** The open tab's sections, in page order. */
  sections: OutlineSection[];
  children: ReactNode;
}) {
  return (
    <OutlinedPage
      width="4xl"
      header={
        <div className="flex flex-col gap-6">
          {header}
          <LinkTabs
            active={active}
            tabs={RECORD_TABS.map((tab) => ({
              value: tab,
              label: TAB_LABEL[tab],
              href: programStudentHref(programId, studentId, tab),
            }))}
          />
        </div>
      }
      sections={sections}
    >
      <div className="flex flex-col gap-12">{children}</div>
    </OutlinedPage>
  );
}
