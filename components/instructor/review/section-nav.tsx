"use client";

/**
 * A row of icons at the head of the review pane, one per card below, each of which scrolls that
 * card into view.
 *
 * The cards on the review pane are the same shape and the same colour, so an instructor scrolling
 * for the conversation reads past it and has to come back. The bar answers that with the one thing
 * that tells the cards apart: each card's header carries an icon, and the bar repeats those icons
 * in the order the cards sit on the screen.
 *
 * **The cards tell the bar they exist, rather than the bar knowing which cards there are.** Which
 * cards the pane holds depends on the state of the grade — a released grade, a report being
 * written, or an offer to generate one all sit in the same place — and on decisions made several
 * components down, some of them from state those components keep to themselves. A list kept in the
 * pane would have to repeat every one of those decisions and would drift from them. Instead each
 * card calls `useSectionAnchor` with its own label and icon, and the bar draws whatever is
 * registered, so a card that is not on the screen is not in the bar.
 *
 * **Ordered by where the cards are, not by when they registered.** The pane is two columns when it
 * is wide and one when it is narrow, and the narrow order is not the wide one: the work is the left
 * column when split and the *last* thing when stacked, by a CSS `order` on the same markup. The
 * document order is therefore wrong in one of the two modes, so the bar sorts by position on the
 * screen — left to right between the columns, top to bottom within one — and sorts again when the
 * window is resized, which is the one event that can change the mode without any card re-rendering.
 * When split, a thin line separates the left column's icons from the right column's, so the
 * instructor can tell which half of the pane an icon will scroll.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Anchor = {
  /** The words in the card's header, used as the tooltip and the accessible name. */
  label: string;
  /** The icon in the card's header, so the bar shows the same picture the card does. */
  icon: React.ElementType;
  /** The icon's colour where the card's header colours it, so the bar matches. */
  iconClassName?: string;
};

type Entry = Anchor & { element: HTMLElement };

type Registry = {
  register: (key: string, entry: Entry) => void;
  unregister: (key: string) => void;
};

const RegistryContext = React.createContext<Registry | null>(null);
const EntriesContext = React.createContext<ReadonlyMap<string, Entry>>(new Map());

/** Holds what the cards beneath it register. The bar and the cards must both be inside one. */
export function SectionNavProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = React.useState<ReadonlyMap<string, Entry>>(() => new Map());

  const registry = React.useMemo<Registry>(
    () => ({
      register: (key, entry) =>
        setEntries((current) => {
          const next = new Map(current);
          next.set(key, entry);
          return next;
        }),
      unregister: (key) =>
        setEntries((current) => {
          if (!current.has(key)) return current;
          const next = new Map(current);
          next.delete(key);
          return next;
        }),
    }),
    [],
  );

  return (
    <RegistryContext.Provider value={registry}>
      <EntriesContext.Provider value={entries}>{children}</EntriesContext.Provider>
    </RegistryContext.Provider>
  );
}

/**
 * Puts the element the returned ref is attached to in the bar, under the given label and icon,
 * for as long as it is on the screen.
 *
 * A callback ref rather than a ref object read in an effect, because several of these cards draw
 * a skeleton first and the card only once their data arrives. An effect runs when its
 * dependencies change, and nothing in the dependencies changes when a skeleton becomes a card —
 * so the card would never register. React calls a callback ref at the moment the element is
 * attached, whichever render that happens in, and calls it again with `null` when the element
 * leaves. It also re-calls it when the callback itself changes, which is how a label that changes
 * while the card stays — the offer to generate a report becoming an offer to generate another —
 * reaches the bar.
 *
 * Harmless outside a provider: a card drawn on a screen without a bar registers with nothing.
 */
export function useSectionAnchor<T extends HTMLElement = HTMLDivElement>(
  anchor: Anchor,
): React.RefCallback<T> {
  const key = React.useId();
  const registry = React.useContext(RegistryContext);
  const { label, icon, iconClassName } = anchor;

  return React.useCallback(
    (element: T | null) => {
      if (!registry) return;
      if (element === null) {
        registry.unregister(key);
        return;
      }
      /*
        Focus follows the jump, so that somebody using the keyboard who picks a card from the bar
        has their next Tab land inside that card rather than back at the bar. A card is a `div`,
        which cannot take focus until it is given a tab index; -1 lets a script focus it without
        adding it to the Tab order.
      */
      if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
      registry.register(key, { element, label, icon, iconClassName });
    },
    [registry, key, label, icon, iconClassName],
  );
}

/**
 * A box in the bar, for a group of things the pane draws itself rather than a card with a header
 * of its own: the student's attachments, or the rubric cards taken together.
 *
 * A component rather than a call to `useSectionAnchor` in the pane, because the pane is what
 * renders the provider. A hook called in the pane's own function runs above the provider in the
 * tree and reads an empty context, so it registers with nothing; a component rendered among the
 * pane's children is beneath the provider and registers with it.
 */
export function SectionAnchor({
  label,
  icon,
  iconClassName,
  className,
  children,
}: Anchor & { className?: string; children: React.ReactNode }) {
  const anchor = useSectionAnchor({ label, icon, iconClassName });
  return (
    <div ref={anchor} className={className}>
      {children}
    </div>
  );
}

/**
 * The bar itself: the jumps on the left, and whatever the screen puts at the right end of the row.
 *
 * The jumps are drawn only where there are at least two cards to move between, because a bar with
 * one icon offers a jump to the only place there is. The row survives without them when there are
 * actions to hold, which is how the way into grading mode keeps one position on the screen whether
 * or not a submission is open.
 *
 * The row is drawn whenever it holds either, and some of what it holds decides its own width:
 * the grading-mode controls draw nothing below `lg`, where there is no two-pane layout to enter or
 * leave, while the way to agree a deadline is offered at every width.
 *
 * **`@container`, so what is in the row measures itself against the row.** How much room a control
 * here has is not a question the window can answer: the pane loses 360px to the docked list and
 * takes it back when grading mode puts the list away, so the same window gives this row two very
 * different widths. A control that has a long form and a short one asks the row which it has room
 * for. **Nothing on the row element itself may carry an `@` class**, because an element cannot
 * answer its own container query — such a class would ask about the nearest container *above* this
 * one and silently never apply.
 */
export function SectionNavBar({
  className,
  actions,
}: {
  className?: string;
  actions?: React.ReactNode;
}) {
  const entries = React.useContext(EntriesContext);

  /*
    Re-sorted on resize. Sorting reads each card's position, which the window's width decides
    through the pane's container query, and nothing registers anew when the width changes.
  */
  const [, resized] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => {
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);

  const jumps = entries.size >= 2;
  if (!jumps && !actions) return null;

  const ordered = !jumps
    ? []
    : [...entries]
        .map(([key, entry]) => ({ key, ...entry, rect: entry.element.getBoundingClientRect() }))
        .sort((a, b) =>
          sameColumn(a.rect, b.rect) ? a.rect.top - b.rect.top : a.rect.left - b.rect.left,
        );

  return (
    <div className={cn("@container flex shrink-0 items-center gap-2", className)}>
      {jumps && (
        <nav
          aria-label="Jump to a part of this review"
          className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
        >
          {ordered.map((entry, index) => (
            <React.Fragment key={entry.key}>
              {/*
                  A line where the next icon belongs to another column. Stacked, every card shares
                  one left edge and no line is drawn; split, the line falls between the work's
                  icons and the grade's, so the bar reads in the same two halves as the pane. The
                  line is 24px in a 40px bar, which leaves an even 8px above and below it.

                  `data-vertical:self-center` replaces the separator's own `self-stretch`. A
                  stretch with a fixed height does not stretch, and the browser then places the
                  line at the top of the row instead of centring it. The override needs the same
                  `data-vertical:` prefix, because a plain `self-center` loses to the more
                  specific attribute selector.
                */}
              {index > 0 && !sameColumn(ordered[index - 1].rect, entry.rect) && (
                <Separator orientation="vertical" className="mx-1 h-6 data-vertical:self-center" />
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={entry.label}
                      onClick={() => jumpTo(entry.element)}
                    />
                  }
                >
                  <entry.icon className={cn("size-4 text-muted-foreground", entry.iconClassName)} />
                </TooltipTrigger>
                <TooltipContent side="bottom">{entry.label}</TooltipContent>
              </Tooltip>
            </React.Fragment>
          ))}
        </nav>
      )}

      {/* The far right of the row, whichever width it is drawn at and whatever is to its left. */}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Whether two cards sit in the same column. The sort and the divider both ask this, so the line
 * is drawn exactly where the sort moves from one column to the next. A pixel of tolerance, so two
 * cards whose left edges differ by rounding read as one column.
 */
function sameColumn(a: DOMRect, b: DOMRect): boolean {
  return Math.abs(a.left - b.left) <= 1;
}

/**
 * Brings the card to the top of whichever box scrolls it: the pane when stacked, its own column
 * when split. `scrollIntoView` scrolls every ancestor that needs to move, so the caller does not
 * have to know which mode the pane is in. A reader who has asked the operating system for less
 * motion gets the jump without the glide.
 */
function jumpTo(element: HTMLElement): void {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ block: "start", behavior: reduceMotion ? "instant" : "smooth" });
  element.focus({ preventScroll: true });
}
