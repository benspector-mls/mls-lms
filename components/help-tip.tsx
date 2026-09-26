"use client";

import { CircleHelp } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A "?" beside a heading that explains the figures under it, on hover or focus.
 *
 * **The explanation is kept, and moved off the page.** A list somebody acts on still has to say
 * what put a person on it, but a paragraph under every heading made the explanation and the finding
 * the same size and the same gray, and a reader could not tell which of the two they were meant to
 * read. The finding stays on the page; the reason is one hover away.
 *
 * A button rather than a bare icon, so a keyboard reaches it and a screen reader names it. A client
 * component because the tooltip is, and the server components that use it hand it plain text.
 */
export function HelpTip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="What this means"
            className={cn(
              "inline-flex items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              className,
            )}
          />
        }
      >
        <CircleHelp className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-left">{children}</TooltipContent>
    </Tooltip>
  );
}
