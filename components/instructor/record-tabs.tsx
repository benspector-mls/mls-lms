"use client";

import * as React from "react";

import { OutlinedPage, type OutlineSection } from "@/components/outlined-page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Tab = "performance" | "coaching";

/**
 * The fellow's record as a page with an outline: the header and the tab strip above it, and an "On
 * this page" list that names the sections of whichever tab is open.
 *
 * **The outline follows the tab, which is why the tab is held here.** A tab that is not showing is
 * not on the page, so a list naming its sections would link to nothing. `OutlinedPage` is given the
 * open tab's sections, and the record itself, a server component, hands both lists down as data
 * beside the two panels it renders.
 */
export function RecordTabs({
  header,
  sections,
  performance,
  coaching,
}: {
  /** The page title and the identity card, above the tab strip. */
  header: React.ReactNode;
  /** Each tab's sections, in page order. */
  sections: Record<Tab, OutlineSection[]>;
  performance: React.ReactNode;
  coaching: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<Tab>("performance");

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
      <OutlinedPage
        width="4xl"
        header={
          <div className="flex flex-col gap-6">
            {header}
            <TabsList>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="coaching">Coaching</TabsTrigger>
            </TabsList>
          </div>
        }
        sections={sections[tab]}
      >
        <TabsContent value="performance" className="flex flex-col gap-12">
          {performance}
        </TabsContent>
        <TabsContent value="coaching" className="flex flex-col gap-12">
          {coaching}
        </TabsContent>
      </OutlinedPage>
    </Tabs>
  );
}
