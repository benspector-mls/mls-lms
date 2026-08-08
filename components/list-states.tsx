"use client";

import * as React from "react";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <span className="sr-only" aria-hidden={false}>
        Loading…
      </span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border border-border px-4 py-3">
          <Skeleton className="size-9 rounded-md" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

/**
 * The icon is an element, not a component.
 *
 * `icon={Inbox}` reads better and cannot work: this is a client component, and a lucide
 * icon is a `forwardRef` object, which is not serializable — a server component passing one
 * gets "Functions cannot be passed directly to Client Components" at render time. Nothing
 * catches it at build, and it only fires when the empty state actually shows, so three
 * screens carried the bug until a course with no work outstanding made one of them appear.
 *
 * `icon={<Inbox />}` is an element, which crosses the boundary like any other child — the
 * same reason `action` below has always been a `ReactNode`. Sizing moves to the wrapper so
 * a caller cannot get it wrong.
 */
export function EmptyState({
  title,
  description,
  icon = <Inbox />,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-14 text-center",
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground text-balance">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description = "This did not load. Trying again is usually enough; if it is not, the message above is worth reporting.",
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground text-balance">{description}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw data-icon="inline-start" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
