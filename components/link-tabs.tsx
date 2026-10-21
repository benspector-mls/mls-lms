"use client";

import Link from "next/link";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * A tab strip whose tabs are links.
 *
 * **The address holds which tab is open**, which is what makes a tab something a link can point
 * at, a bookmark can keep, and the back button can return to. The page beneath is the open tab's
 * content, so there is no `TabsContent` here: each tab is a page of its own that renders this strip
 * with its own value marked active.
 *
 * Drawn with the same `Tabs` pieces as a strip held in client state, so the two kinds look alike,
 * with each trigger rendered as a `Link` through base-ui's `render` prop, the way the sidebar's
 * buttons are.
 */
export function LinkTabs({
  active,
  tabs,
}: {
  active: string;
  tabs: { value: string; label: string; href: string }[];
}) {
  return (
    <Tabs value={active}>
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} render={<Link href={tab.href} />}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
