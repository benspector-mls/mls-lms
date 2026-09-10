import * as React from "react";

import { cn } from "@/lib/utils";

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground shadow-xs ring-1 ring-foreground/10 ring-inset [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The two surfaces this application draws, as class strings.
 *
 * Three levels, and each one has exactly one rule. **The page ground** is `--background`, and
 * nothing paints it. **A panel** is a fill one step above it with a ring around it — what
 * `Card` draws, for the places that want the surface without its header, content and footer slots,
 * and for the two call sites that are a `<form>` and so could not be a component rendering a
 * `<div>` anyway. **An inset** is what sits inside a panel: a fill one step *below* it, with no
 * ring at all.
 *
 * Written out by hand, as these were at eleven sites, the two levels had already collapsed into
 * one — a bordered white box inside a bordered white box, so a submitted link read as a sibling of
 * the panel holding it rather than as its contents. The rule is what stops that, and one copy of
 * the rule is what stops the rule drifting.
 *
 * A panel and not an inset is the decision to get right, and the question that settles it is what
 * the thing sits *beside*: the submission panels on the review screen are peers of the `Card` that
 * lists the changed files, so they are panels, and the document inside one is the inset.
 *
 * **`ring-inset` is not decoration.** An ordinary ring paints *outside* the border box, so the top
 * of it is clipped away by any scroll container the panel starts flush against — which is what the
 * student's assignment panel does, and the first card in it lost its top edge. Painting the ring
 * inside cannot be clipped by anything, and costs a pixel of the panel's own width rather than a
 * pixel of padding at every container that might ever hold one.
 *
 * Padding is the call site's, as it is for an inset: a unit's card on a course page is headed by a
 * strip that runs to its own edges and cannot have any.
 */
const panelSurface = "rounded-xl bg-card shadow-xs ring-1 ring-foreground/10 ring-inset";

/** Padding is left to the call site: an inset is as often a frame as a box. */
const insetSurface = "rounded-md bg-muted/50";

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("px-(--card-spacing)", className)} {...props} />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  panelSurface,
  insetSurface,
};
