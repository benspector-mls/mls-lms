"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/** One entry in the outline: the `id` of a `<section>` on the page, and the words that name it. */
export type OutlineSection = {
  id: string;
  label: string;
  /**
   * How many rows the section holds, shown beside the label. An entry with a count of 0 is drawn
   * but is not a link, because a page that hides its empty sections has nothing for it to jump to.
   */
  count?: number;
  /** The colour of a non-zero count. A count of nought is always muted, whatever its tone. */
  tone?: keyof typeof toneClasses;
  /** Drawn before the label, for a list whose entries are of different kinds. */
  icon?: React.ElementType;
};

const toneClasses = {
  danger: "text-destructive",
  teal: "text-teal-600 dark:text-teal-400",
  green: "text-emerald-600 dark:text-emerald-400",
} as const;

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
 * **`--outline-sticky-top` is defined in the side-column layout only**, as the bottom edge of the
 * shell header and the View-as banner. A section heading that should stick on a wide screen and
 * scroll normally beside the strip uses `sticky top-(--outline-sticky-top)`. Beside the strip the
 * variable is undefined, so `top` falls back to `auto`, and a sticky element whose `top` is `auto`
 * never sticks. The strip's breakpoint therefore lives here alone rather than being copied into
 * every page that wants a sticky heading — a copy that drifted would stick headings behind the strip.
 *
 * **Which section is current is worked out from scroll position, not from an IntersectionObserver.**
 * The rule is simple to state and simple to check: the current section is the last one whose top
 * edge has passed the offset, or the last section of all once the page is scrolled to its end —
 * that second clause is for a short final card that can never reach the top on its own. An
 * observer answers a different question (what is visible) and gives surprising answers for short
 * sections and for a tall section that fills the whole viewport.
 *
 * **An entry may carry a count, and a count of nought is drawn without a link.** The student
 * dashboard hides every section that has no rows, and lists all of its sections here anyway so a
 * fellow reads "New comments 0" and knows nothing is waiting. An anchor to a section that is not on
 * the page would scroll nowhere, so the nought entry is plain text in muted colour instead. The
 * active-section measurement already ignores ids with no element behind them, so a nought entry
 * can never be highlighted as current.
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
        {/*
          Nothing rather than an empty bar when there are no sections — a course with no units yet,
          or one whose units are still loading, would otherwise show a blank strip under its title.
        */}
        {sections.length > 0 && <Outline sections={sections} className={layout.nav} />}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

const layouts = {
  "3xl": {
    frame:
      "max-w-3xl @min-[63rem]:max-w-[60rem] @min-[63rem]:grid-cols-[minmax(0,1fr)_10rem] @min-[63rem]:gap-x-8 @min-[63rem]:[--outline-offset:calc(4.5rem_+_var(--view-as-banner,0px))] @min-[63rem]:[--outline-sticky-top:calc(3.5rem_+_var(--view-as-banner,0px))]",
    nav: "@min-[63rem]:col-start-2 @min-[63rem]:row-start-1 @min-[63rem]:row-span-2 @min-[63rem]:self-start @min-[63rem]:top-[calc(4.5rem_+_var(--view-as-banner,0px))] @min-[63rem]:h-auto @min-[63rem]:border-b-0 @min-[63rem]:bg-transparent",
  },
  "4xl": {
    frame:
      "max-w-4xl @min-[71rem]:max-w-[68rem] @min-[71rem]:grid-cols-[minmax(0,1fr)_10rem] @min-[71rem]:gap-x-8 @min-[71rem]:[--outline-offset:calc(4.5rem_+_var(--view-as-banner,0px))] @min-[71rem]:[--outline-sticky-top:calc(3.5rem_+_var(--view-as-banner,0px))]",
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
    In the strip, the links can be wider than the page, and in the side column a long outline is
    taller than its capped height, so either way the current one may be scrolled out of the list's
    own view. Bring it back without touching the page's scroll — `scrollIntoView` would move every
    scrolling ancestor, so this moves only the list. Each layout overflows on one axis only, so only
    one of the two checks below can ever move it.
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
    const top = link.offsetTop;
    const bottom = top + link.offsetHeight;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: top - 16, behavior: "smooth" });
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
        /*
          In the side column, capped at the height left below the stuck chrome and scrolled with a
          visible scrollbar. A course's outline can run to eighteen entries, and the column sticks,
          so without the cap the last entries would sit below the bottom of the screen where no
          amount of page scrolling reaches them. The scrollbar is hidden only in the strip, where
          sideways scrolling is shown by the entries cut off at its edge.
        */
        className="relative flex w-full flex-col gap-0.5 overflow-x-auto @max-[16rem]:max-h-[calc(100svh_-_6rem_-_var(--view-as-banner,0px))] @min-[16rem]:flex-row @min-[16rem]:items-center @min-[16rem]:gap-1 @min-[16rem]:[scrollbar-width:none] @min-[16rem]:[&::-webkit-scrollbar]:hidden"
      >
        <li className="px-2.5 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase @min-[16rem]:hidden">
          On this page
        </li>
        {sections.map((section) => {
          const isActive = section.id === active;
          const empty = section.count === 0;
          const Icon = section.icon;

          /*
            The label and, when there is one, the count. `whitespace-nowrap` only in the strip,
            where the list scrolls sideways and a wrapped entry would break the row; in the side
            column a long label wraps onto a second line rather than running past 10rem.
          */
          const content = (
            <>
              {Icon ? (
                <span className="flex gap-1.5">
                  <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {section.label}
                </span>
              ) : (
                section.label
              )}
              {section.count != null && (
                <span
                  className={cn(
                    "ml-1.5 text-xs tabular-nums",
                    section.tone && !empty && ["font-medium", toneClasses[section.tone]],
                  )}
                >
                  {section.count}
                </span>
              )}
            </>
          );

          return (
            <li key={section.id} className="shrink-0">
              {empty ? (
                <span className="block rounded-md px-2.5 py-1.5 text-sm text-muted-foreground/60 @min-[16rem]:whitespace-nowrap">
                  {content}
                </span>
              ) : (
                <a
                  href={`#${section.id}`}
                  aria-current={isActive ? "location" : undefined}
                  className={cn(
                    "block rounded-md px-2.5 py-1.5 text-sm transition-colors @min-[16rem]:whitespace-nowrap",
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {content}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
