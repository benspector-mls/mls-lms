"use client";

import { TableOfContents } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** One entry in the outline: the `id` of a `<section>` on the page, and the words that name it. */
export type OutlineSection = {
  id: string;
  label: string;
  /**
   * 2 for an entry that belongs to the level-1 entry before it. A lesson passes its `###` headings
   * at level 2; every other screen's entries are level 1.
   */
  level?: 1 | 2;
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
 * A page of cards or reading with an outline, "On this page", that jumps to each section.
 *
 * **Two layouts, chosen by how wide the page's own column is rather than by the viewport.** When
 * there is room beside the content for a 10rem column, the outline is a list there and stays in
 * view as the page scrolls. When there is not, an **On this page** button floats at the top right
 * of the page, where the title row leaves space, and opens the same list in a panel from the
 * right. The measure is the width of
 * `<main>`, not the window, because the sidebar takes 16rem of the window when it is open and 3rem
 * when it is collapsed to its rail: whether the column fits is a fact about what is left after the
 * sidebar, and a viewport breakpoint would have to guess.
 *
 * **The threshold depends on how wide the content is allowed to be.** A page capped at 48rem needs
 * 48rem for the content, 10rem for the column, 2rem between them and 3rem of page padding, so 63rem;
 * one capped at 56rem needs 71rem. Tailwind needs every variant written out, so each cap has its own
 * strings below rather than a number plugged into one.
 *
 * **A page with no sections is one column at every width.** Without that, the grid would keep the
 * outline's narrow column on a wide screen and the content would fall into it.
 *
 * **Jumps land the heading just under whatever is stuck above the page.** Every section carries
 * `scroll-mt-(--outline-offset)`, and this component sets that variable from `--outline-chrome`:
 * the shell header and the View-as banner, which the shell sets, and a bar a layout sticks above
 * its pages, as the lessons do. The same variable is what the active-section measurement reads, so
 * the entry that highlights is the section a jump would have put there.
 *
 * **`--outline-sticky-top` is the bottom edge of `--outline-chrome`, at every width.** A heading written `sticky top-(--outline-sticky-top)` stays at the top of the screen
 * while its section is being read, on a phone as on a wide screen, so the reader always sees which
 * section they are in.
 *
 * **Which section is current is worked out from scroll position, not from an IntersectionObserver.**
 * The current section is the last one whose top edge has passed the offset, or the last section of
 * all once the page is scrolled to its end — that second clause is for a short final section that
 * can never reach the top on its own. An observer answers a different question (what is visible)
 * and gives surprising answers for short sections and for a tall section that fills the screen.
 *
 * **An entry may carry a count, and a count of nought is drawn without a link.** The student
 * dashboard hides every section that has no rows, and lists all of its sections here anyway so a
 * fellow reads "New comments 0" and knows nothing is waiting. An anchor to a section that is not on
 * the page would scroll nowhere, so the nought entry is plain text in muted colour instead.
 */
export function OutlinedPage({
  width,
  header,
  sections,
  outline = "column",
  children,
}: {
  /** The cap on the content's width, which also decides when the side column fits. */
  width: "3xl" | "4xl";
  /** The page's title block, which sits above the content and beside the column. */
  header: React.ReactNode;
  /** In page order. Every `id` must be on an element in `children` with `scroll-mt-(--outline-offset)`. */
  sections: OutlineSection[];
  /**
   * `strip` keeps the outline a sideways-scrolling bar stuck under the shell header at every width,
   * with no side column and no button. The dashboard uses it, because its entries carry counts —
   * "New comments 2" — that a fellow must be able to read from anywhere on the page without
   * opening anything.
   */
  outline?: "column" | "strip";
  children: React.ReactNode;
}) {
  const layout = layouts[width];
  const hasOutline = sections.length > 0;
  const active = useActiveSection(sections);

  const strip = outline === "strip" && hasOutline;

  return (
    <div className="@container">
      {hasOutline && !strip && (
        <div className={cn(FLOATING_TOP, layout.button)}>
          <OutlinePanel
            sections={sections}
            active={active}
            className="absolute top-2 right-4 md:right-6"
          />
        </div>
      )}
      <div
        className={cn(
          "mx-auto grid w-full grid-cols-1 gap-6 p-4 md:p-6",
          strip
            ? /*
                The strip is 3rem tall and sticks under the chrome, so a jump lands a section below
                the strip, and anything stuck stays below it too.
              */
              "[--outline-offset:calc(var(--outline-chrome)_+_3.5rem)] [--outline-sticky-top:calc(var(--outline-chrome)_+_3rem)]"
            : "[--outline-offset:calc(var(--outline-chrome)_+_1rem)] [--outline-sticky-top:var(--outline-chrome)]",
          hasOutline && !strip ? layout.frame : layout.single,
        )}
      >
        {header}
        {hasOutline && (
          <nav aria-label="On this page" className={strip ? STRIP_NAV : layout.nav}>
            <OutlineList sections={sections} active={active} heading={!strip} strip={strip} />
          </nav>
        )}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

/**
 * A row with no height stuck just under the chrome, which "On this page" floats in at the top right
 * of a narrow page. It takes no room, so it sits over the top of the page — where the title row
 * leaves its right end empty — and stays there as the page scrolls. It is placed before the page so
 * its first position is the page's top, and above stuck headings so they pass beneath it. A
 * `fixed` button would not work: the page is a size container, and a `fixed` element inside one
 * scrolls away with it.
 */
const FLOATING_TOP = "pointer-events-none sticky top-(--outline-chrome) z-20 h-0";

/** The strip: one row stuck under the shell header, at every width. */
const STRIP_NAV =
  "sticky top-(--outline-chrome) z-10 flex h-12 items-center border-b border-border bg-background";

const layouts = {
  "3xl": {
    single: "max-w-3xl",
    frame:
      "max-w-3xl @min-[63rem]:max-w-[60rem] @min-[63rem]:grid-cols-[minmax(0,1fr)_10rem] @min-[63rem]:gap-x-8",
    nav: "hidden @min-[63rem]:sticky @min-[63rem]:col-start-2 @min-[63rem]:row-span-2 @min-[63rem]:row-start-1 @min-[63rem]:block @min-[63rem]:self-start @min-[63rem]:top-[calc(var(--outline-chrome)_+_1rem)]",
    button: "@min-[63rem]:hidden",
  },
  "4xl": {
    single: "max-w-4xl",
    frame:
      "max-w-4xl @min-[71rem]:max-w-[68rem] @min-[71rem]:grid-cols-[minmax(0,1fr)_10rem] @min-[71rem]:gap-x-8",
    nav: "hidden @min-[71rem]:sticky @min-[71rem]:col-start-2 @min-[71rem]:row-span-2 @min-[71rem]:row-start-1 @min-[71rem]:block @min-[71rem]:self-start @min-[71rem]:top-[calc(var(--outline-chrome)_+_1rem)]",
    button: "@min-[71rem]:hidden",
  },
} as const;

/** The id of the section being read, measured from the scroll position. */
function useActiveSection(sections: OutlineSection[]): string | null {
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

  return active;
}

/**
 * The outline on a narrow page: a button floating at the top right of the page, and the panel it
 * opens. `OutlinedPage` places it in a `FLOATING_TOP` row.
 *
 * **Choosing an entry closes the panel first and moves the page after.** The panel locks the
 * page's scrolling while it is open, so a jump made at the moment of the click would be undone when
 * the lock is released.
 */
function OutlinePanel({
  sections,
  active,
  className,
}: {
  sections: OutlineSection[];
  active: string | null;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const pending = React.useRef<string | null>(null);

  return (
    <div className={className}>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(isOpen) => {
          if (isOpen || pending.current === null) return;
          const id = pending.current;
          pending.current = null;
          document.getElementById(id)?.scrollIntoView();
          // A step the Back button returns from, as a jump from the column's link is.
          history.pushState(null, "", `#${id}`);
        }}
      >
        <Button
          type="button"
          variant="outline"
          className="pointer-events-auto rounded-full shadow-md"
          onClick={() => setOpen(true)}
          data-icon="inline-start"
        >
          <TableOfContents aria-hidden />
          On this page
        </Button>
        <SheetContent side="right" className="gap-0 p-0">
          <SheetTitle className="px-4 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            On this page
          </SheetTitle>
          <div className="min-h-0 overflow-y-auto px-2 pb-4">
            <OutlineList
              sections={sections}
              active={active}
              onChoose={(id) => {
                pending.current = id;
                setOpen(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * The entries, in the side column or in the panel. In the panel, `onChoose` takes over from the
 * link so the panel can close before the page moves; see `OutlinePanel`.
 */
function OutlineList({
  sections,
  active,
  heading = false,
  strip = false,
  onChoose,
}: {
  sections: OutlineSection[];
  active: string | null;
  /** Whether the list carries its own "On this page" heading; the panel has a title instead. */
  heading?: boolean;
  /** One sideways-scrolling row, for `OutlinedPage`'s strip. */
  strip?: boolean;
  onChoose?: (id: string) => void;
}) {
  const listRef = React.useRef<HTMLUListElement>(null);

  /*
    A long outline is taller than its box, so the current entry may be scrolled out of view. Bring
    it back without touching the page's scroll — `scrollIntoView` would move every scrolling
    ancestor, so this moves only the box. In the side column and the strip the list is the box; in
    the panel — the list with neither a heading nor a strip — the body around the list scrolls, and the entry is
    brought into view as the panel opens. The strip scrolls sideways and the others downwards, so
    only one of the two checks can ever move a box.
  */
  React.useEffect(() => {
    const list = listRef.current;
    const box = heading || strip ? list : list?.parentElement;
    const link = active
      ? list?.querySelector<HTMLElement>(`[href="#${CSS.escape(active)}"]`)
      : null;
    if (!box || !link) return;
    const outer = box.getBoundingClientRect();
    const inner = link.getBoundingClientRect();
    if (inner.top < outer.top || inner.bottom > outer.bottom) {
      box.scrollBy({ top: inner.top - outer.top - 16, behavior: "smooth" });
    }
    if (inner.left < outer.left || inner.right > outer.right) {
      box.scrollBy({ left: inner.left - outer.left - 16, behavior: "smooth" });
    }
  }, [active, heading, strip]);

  return (
    <ul
      ref={listRef}
      /*
        In the side column, capped at the height left below the stuck header and scrolled. A
        course's outline can run to eighteen entries and a lesson's to thirty, and the column
        sticks, so without the cap the last entries would sit below the bottom of the screen where
        no amount of page scrolling reaches them. The panel scrolls as a whole instead, so the list
        there has no cap of its own.
      */
      className={cn(
        "relative flex",
        strip
          ? "w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex-col gap-0.5",
        heading && "max-h-[calc(100svh_-_var(--outline-chrome)_-_2.5rem)] overflow-y-auto",
      )}
    >
      {heading && (
        <li className="px-2.5 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          On this page
        </li>
      )}
      {sections.map((section) => {
        const isActive = section.id === active;
        const empty = section.count === 0;
        const Icon = section.icon;

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
          <li
            key={section.id}
            className={cn(
              strip && "shrink-0 whitespace-nowrap",
              section.level === 2 && "ml-2.5 border-l border-border pl-1.5",
            )}
          >
            {empty ? (
              <span className="block rounded-md px-2.5 py-1.5 text-sm text-muted-foreground/60">
                {content}
              </span>
            ) : (
              <a
                href={`#${section.id}`}
                aria-current={isActive ? "location" : undefined}
                onClick={
                  onChoose
                    ? (event) => {
                        // A click meant for a new tab or window is the browser's to keep.
                        if (!isPlainClick(event)) return;
                        event.preventDefault();
                        onChoose(section.id);
                      }
                    : undefined
                }
                className={cn(
                  "block rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  section.level === 2 && "py-1 text-[0.8125rem]",
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
  );
}

/** A left click with no key held, which is a click meant for this tab. */
export function isPlainClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
