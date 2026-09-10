"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/*
  `isolate` keeps the frozen first column's `z-10` inside this table. Without it, that z-index
  competes with the shell's sticky breadcrumb header, which is also `z-10` and comes earlier in
  the document — so scrolling the page down drew student names over the breadcrumbs. A stacking
  context here leaves the column raised above the cells passing behind it, which is its whole job,
  and below everything outside the table. The overlays a row opens — a dialog, a dropdown — are
  portalled to the body and so are not held under it.
*/
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative isolate w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

/**
 * The frozen first column of a wide table: the student's name, held in place while the marks
 * scroll under it.
 *
 * **Opaque, and that is the whole job.** The cells being scrolled pass *behind* this one, so any
 * transparency at all lets their text show through it as a ghost — which rules out the `/50` that
 * would otherwise be the obvious way to make the fill subtle.
 *
 * **Its own token, because one value cannot serve both themes.** These carried `bg-card`, which in
 * light mode is pure white and so is `--background` — and a table that paints no background of its
 * own is the page. The column masked the scrolling marks correctly and looked like nothing, so the
 * one column an instructor reads down had no edge to read along. But `--muted`, which is the right
 * step darker on a white page, is a step *lighter* on a dark one and a far longer step: the token
 * that is barely there in light reads as a stripe down the table in dark. So `--table-sticky` is
 * `--muted` in light and `--card` in dark, set in `globals.css`.
 *
 * A token and not a `dark:` utility, which would have said the same thing in one class: most
 * readers have never touched the theme toggle, so they carry no class on the root and are decided
 * by a media query — and `dark:` here is defined as `&:is(.dark *)`, which matches none of them.
 *
 * One constant because four screens draw this table and they are copies of each other by their own
 * admission — see the note at the top of `attendance-term.tsx`. Eleven hand-written copies is how
 * three of them come to be one shade off the fourth.
 */
const stickyColumn = "sticky left-0 z-10 bg-table-sticky";

/**
 * The row of content inside a frozen name cell: the name, and whatever sits beside it.
 *
 * **Capped, so that one long name cannot set the width of the column.** A frozen column is
 * subtracted from the screen — every marks column has to fit in what is left of a phone — and a
 * table's column takes the width of its widest cell, so a single fellow with a long name narrows
 * every row's view of the marks. The name scrolls sideways within its cell instead.
 *
 * The cap has to sit here rather than on the `<td>`, which carries `whitespace-nowrap`: a cell's
 * `max-width` is advisory in an auto-layout table and unwrappable text overrides it, while a
 * block inside the cell contributes only its own capped width to the column.
 *
 * `no-scrollbar` because this is one scroller per row. Where a scrollbar takes real space rather
 * than floating over the content, as it does on Windows, a bar inside every name would add height
 * to every row of the table and draw a line down the column. The names remain reachable: the cell
 * takes a swipe or a shift-wheel, and tabbing to the link inside scrolls it into view.
 */
const stickyColumnContent = "no-scrollbar flex max-w-48 items-center gap-2 overflow-x-auto";

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  stickyColumn,
  stickyColumnContent,
};
