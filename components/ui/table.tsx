"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
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
};
