"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/** One entry in the outline: the `id` of a `<section>` on the page, and the words that name it. */
export type OutlineSection = { id: string; label: string };

/**
 * A page of settings cards with an outline that jumps to each one.
 *
 * **Two layouts, chosen by how wide the page's own column is rather than by the viewport.** When
 * there is room beside the cards for a 10rem column, the outline is a vertical list there and stays
 * in view as the page scrolls. When there is not, the outline is a horizontal strip under the page
 * title that sticks just below the shell's header, so the links are still reachable from anywhere
 * on the page. The measure is the width of `<main>`, not the window, because the sidebar takes 16rem
 * of the window when it is open and 3rem when it is collapsed to its rail: whether the column fits
 * is a fact about what is left after the sidebar, and a viewport breakpoint would have to guess.
 *
 * **The threshold depends on how wide the cards are allowed to be.** A page whose cards are capped
 * at 48rem needs 48rem for the cards, 10rem for the column, 2rem between them and 3rem of page
 * padding, so 63rem; one capped at 56rem needs 71rem. Making one threshold serve both would mean
 * the wider page's cards narrowing by 12rem the moment the column appeared, which reads as the page
 * breaking rather than as a column arriving. Tailwind needs every variant written out, so each cap
 * has its own string below rather than a number plugged into one.
 *
 * **The strip is a second container query, on the outline itself.** In the side column the outline
 * is exactly 10rem wide; in the strip it is as wide as the cards, which is never less than 18rem on
 * any phone this application supports. So the list lays itself out vertically or horizontally from
 * its own width, and neither threshold above has to be repeated on the list.
 *
 * **Jumps land the heading just under whatever is stuck above it.** Every section carries
 * `scroll-mt-(--outline-offset)`, and this component sets that variable for each layout: the shell
 * header is 3.5rem, the strip is 3rem, and `--view-as-banner` is the height of the View-as banner
 * when one is showing, which `ViewAsBanner` publishes because its height depends on how its sentence
 * wraps. The same variable is what the active-section measurement reads, so the link that
 * highlights is the one whose section sits under the stuck chrome, which is also the one a jump
 * would have put there.
 *
 * **Which section is current is worked out from scroll position, not from an IntersectionObserver.**
 * The rule is simple to state and simple to check: the current section is the last one whose top
 * edge has passed the offset, or the last section of all once the page is scrolled to its end —
 * that second clause is for a short final card that can never reach the top on its own. An
 * observer answers a different question (what is visible) and gives surprising answers for short
 * sections and for a tall section that fills the whole viewport.
 */
export function OutlinedPage({
  width,
  header,
  sections,
  children,
}: {
  /** The cap on the cards' width, which also decides when the side column fits. */
  width: "3xl" | "4xl";
  /** The page's title block, which sits above the strip and beside the column. */
  header: React.ReactNode;
  /** In page order. Every `id` must be on a `<section>` in `children` with `scroll-mt-(--outline-offset)`. */
  sections: OutlineSection[];
  children: React.ReactNode;
}) {
  const layout = layouts[width];

  return (
    <div className="@container">
      <div
        className={cn(
          "mx-auto grid w-full grid-cols-1 gap-6 p-4 md:p-6",
          "[--outline-offset:calc(7rem_+_var(--view-as-banner,0px))]",
          layout.frame,
        )}
      >
        {header}
        <Outline sections={sections} className={layout.nav} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

const layouts = {
  "3xl": {
    frame:
      "max-w-3xl @min-[63rem]:max-w-[60rem] @min-[63rem]:grid-cols-[minmax(0,1fr)_10rem] @min-[63rem]:gap-x-8 @min-[63rem]:[--outline-offset:calc(4.5rem_+_var(--view-as-banner,0px))]",
    nav: "@min-[63rem]:col-start-2 @min-[63rem]:row-start-1 @min-[63rem]:row-span-2 @min-[63rem]:self-start @min-[63rem]:top-[calc(4.5rem_+_var(--view-as-banner,0px))] @min-[63rem]:h-auto @min-[63rem]:border-b-0 @min-[63rem]:bg-transparent",
  },
  "4xl": {
    frame:
      "max-w-4xl @min-[71rem]:max-w-[68rem] @min-[71rem]:grid-cols-[minmax(0,1fr)_10rem] @min-[71rem]:gap-x-8 @min-[71rem]:[--outline-offset:calc(4.5rem_+_var(--view-as-banner,0px))]",
    nav: "@min-[71rem]:col-start-2 @min-[71rem]:row-start-1 @min-[71rem]:row-span-2 @min-[71rem]:self-start @min-[71rem]:top-[calc(4.5rem_+_var(--view-as-banner,0px))] @min-[71rem]:h-auto @min-[71rem]:border-b-0 @min-[71rem]:bg-transparent",
  },
} as const;

function Outline({ sections, className }: { sections: OutlineSection[]; className?: string }) {
  const listRef = React.useRef<HTMLUListElement>(null);
  const [active, setActive] = React.useState<string | null>(sections[0]?.id ?? null);

  /*
    Keyed on the ids rather than the array, so a page that rebuilds its list on every render does
    not tear down and re-attach the listeners each time.
  */
  const ids = sections.map((section) => section.id).join(" ");

  React.useEffect(() => {
    const elements = ids
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const root = document.documentElement;
      const scrolls = root.scrollHeight > window.innerHeight;
      const atEnd = scrolls && window.innerHeight + window.scrollY >= root.scrollHeight - 2;

      let current = elements[0];
      if (atEnd) {
        current = elements[elements.length - 1];
      } else {
        for (const element of elements) {
          const offset = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
          if (element.getBoundingClientRect().top <= offset + 2) current = element;
          else break;
        }
      }
      setActive(current.id);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [ids]);

  /*
    In the strip, the links can be wider than the page, and the current one may be scrolled out of
    the strip's own view. Bring it back without touching the page's scroll — `scrollIntoView` would
    move every scrolling ancestor, so this moves only the list.
  */
  React.useEffect(() => {
    const list = listRef.current;
    const link = active
      ? list?.querySelector<HTMLElement>(`[href="#${CSS.escape(active)}"]`)
      : null;
    if (!list || !link) return;
    const left = link.offsetLeft;
    const right = left + link.offsetWidth;
    if (left < list.scrollLeft || right > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: left - 16, behavior: "smooth" });
    }
  }, [active]);

  return (
    <nav
      aria-label="On this page"
      className={cn(
        "@container sticky top-[calc(3.5rem_+_var(--view-as-banner,0px))] z-10 flex h-12 items-center border-b border-border bg-background",
        className,
      )}
    >
      <ul
        ref={listRef}
        className="relative flex w-full flex-col gap-0.5 overflow-x-auto [scrollbar-width:none] @min-[16rem]:flex-row @min-[16rem]:items-center @min-[16rem]:gap-1 [&::-webkit-scrollbar]:hidden"
      >
        <li className="px-2.5 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase @min-[16rem]:hidden">
          On this page
        </li>
        {sections.map((section) => {
          const isActive = section.id === active;
          return (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  "block rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
