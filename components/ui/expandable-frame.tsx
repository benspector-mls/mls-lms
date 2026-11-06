"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A wide grid that can be lifted out of the page to fill the window.
 *
 * The problem it solves is the width a grid gets inside the application: the sidebar, the
 * breadcrumb header and the page's padding all take space from it, and the frozen header caps
 * its height at the window less 7rem, so a laptop shows a few units across and ten rows down.
 * Full screen hands the grid everything inside the browser window.
 *
 * **Restyled in place rather than moved.** The frame becomes `fixed inset-0` around the same
 * children, so React keeps them mounted: the sort, the filters and how far the grid was scrolled
 * are all where the reader left them, on the way in and on the way out. Moving the grid into a
 * dialog or a portal would remount it and drop all three.
 *
 * **Not the browser's own full screen**, which hides everything outside the element made full
 * screen — and every menu, popover and dialog a row opens is rendered at the end of the body,
 * outside it, so each would open invisibly. Those layers sit at `z-50`, above this frame's `z-40`,
 * so they work here unchanged. What this gives up is the browser's tabs and address bar, which
 * stay on screen.
 *
 * `fixed` positions against the window only while no ancestor carries a `transform`, a `filter`
 * or `@container`. None of the screens using this frame has one; adding one above a frame would
 * pin the expanded grid inside that ancestor instead.
 *
 * **Esc leaves full screen only when focus is inside the frame.** A popover or menu opened from a
 * row is rendered outside the frame and closes on Esc itself, so its own Esc must not also close
 * the grid. The frame takes focus when it is clicked (`tabIndex={-1}`), so a reader who clicked a
 * cell and pressed Esc still gets out.
 *
 * **Focus is held inside the frame**, or Tab past the last link would move it onto the covered
 * page, where nothing on screen shows where it went and Esc no longer applies. Focus landing on the
 * covered page is sent back to the frame. The covered page is the element of the body that holds
 * the frame; the menus and dialogs a row opens are other elements of the body, so focus may go to
 * them freely.
 *
 * The frame sets `--table-max-h` for the tables inside it: the window less the bar (3.5rem), the
 * padding around the grid (2rem), and the 1px top and bottom border every grid's wrapper draws —
 * without those 2px the grid overflows the frame and a second scrollbar appears beside its own.
 * See `stickyHeaderContainer` in `table.tsx`.
 */
function ExpandableFrame({
  title,
  actions,
  children,
}: {
  /** What the grid holds, shown in the bar while it fills the window. */
  title: string;
  /** Controls drawn beside the button, on the page and in full screen alike. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const frame = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!expanded) return;

    // The page behind the frame would otherwise scroll under it on a wheel past the grid's end.
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!frame.current?.contains(event.target as Node)) return;
      setExpanded(false);
    }

    const page = frame.current?.closest("body > *");
    function onFocusIn(event: FocusEvent) {
      const target = event.target as Node;
      if (frame.current?.contains(target)) return;
      if (page?.contains(target)) frame.current?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      root.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [expanded]);

  return (
    <div
      ref={frame}
      tabIndex={expanded ? -1 : undefined}
      className={cn(
        "flex flex-col gap-2",
        expanded && "fixed inset-0 z-40 gap-0 bg-background outline-none",
      )}
      style={
        expanded
          ? ({ "--table-max-h": "calc(100svh - 5.5rem - 2px)" } as React.CSSProperties)
          : undefined
      }
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-end gap-2",
          expanded && "h-14 shrink-0 flex-nowrap border-b border-border px-4",
        )}
      >
        {expanded && <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>}
        {actions}
        {/*
          One button for both directions, so keyboard focus stays on it across the change and a
          reader who entered with Enter can leave with Enter.

          The words are for screen readers only on a phone, where the bar cannot hold the title,
          Performance's grouping control and the words together — and the bar does not wrap, so
          the button would be pushed past the edge of a window that no longer scrolls.
        */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <Minimize2 data-icon="inline-start" />
          ) : (
            <Maximize2 data-icon="inline-start" />
          )}
          <span className="max-sm:sr-only">{expanded ? "Exit full screen" : "Full screen"}</span>
        </Button>
      </div>
      <div className={cn(expanded && "min-h-0 flex-1 overflow-auto p-4")}>{children}</div>
    </div>
  );
}

export { ExpandableFrame };
