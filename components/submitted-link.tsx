import { ExternalLink, Link2 } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { linkHost } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * A link a student handed in: where it goes, written out, and a way to open it.
 *
 * **The URL itself is the feature.** This used to be a button reading "Open what the student
 * submitted" and nothing else, which asks an instructor to click into an address they have not
 * been shown — from a page of forty students, in a browser signed into a school account, onto
 * whatever a student pasted. A submitted link is untrusted input in a way an uploaded file is
 * not: the file goes to a private bucket this application controls, and the link goes anywhere.
 *
 * Seeing it also catches the ordinary mistakes, which are far more common than the alarming ones.
 * A Drive assignment submitted as `docs.google.com/document/d/…/template` is the instructor's own
 * template rather than the student's copy; one submitted as a `localhost` address or a bare file
 * path is a paste that never had a chance of working. Every one of those is obvious from the text
 * and invisible behind a button.
 *
 * The host is drawn separately and first because it is the part worth reading, and the full
 * address underneath in a monospace face that wraps rather than truncates — a URL cut off at the
 * width of a column hides its own tail, which is exactly where a wrong one differs.
 *
 * The counterpart of `UploadedFileRow`, deliberately the same shape and the same position on both
 * screens: the two are the same fact about a submission for the two kinds that carry it.
 */
export function SubmittedLinkRow({
  url,
  label,
  isLate = false,
  className,
}: {
  url: string;
  /** What this link is to the reader — the student's own work, or a student's. */
  label: string;
  isLate?: boolean;
  className?: string;
}) {
  const host = linkHost(url);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-background p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">
              {label}
              {isLate ? " (late)" : ""}
            </span>
            {/*
              `break-all` rather than truncation. A URL is read left to right and a wrong one
              usually differs at the end — the document id, the `/template` where a `/edit`
              should be — so an ellipsis hides the part worth checking. Wrapping costs a line
              and shows the whole address.
            */}
            <span className="font-mono text-xs break-all text-muted-foreground">{url}</span>
          </div>
        </div>

        {/*
          **No anchor at all unless `linkHost` accepted the address**, which is what keeps a
          `javascript:` submission from becoming a script that runs on an instructor's signed-in
          page. Refusing at the point the element is created is the version of this that cannot be
          got wrong later — a check that only greyed the button out would still leave the href in
          the document.
        */}
        {host && (
          <a
            href={url}
            target="_blank"
            /*
              `noopener` as well as `noreferrer`, and it is not decoration here: this is a link a
              student chose, and without it the page it opens gets a handle on this one through
              `window.opener` and can navigate it somewhere else.
            */
            rel="noreferrer noopener"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
          >
            Open
            <ExternalLink data-icon="inline-end" />
          </a>
        )}
      </div>

      {host ? (
        <p className="text-xs text-muted-foreground">
          Opens <span className="font-medium text-foreground">{host}</span> in a new tab.
        </p>
      ) : (
        /*
          Said rather than left as a missing button. Submissions predating the scheme check can
          hold one of these, and an instructor looking at work they cannot open needs to know it
          is the submission that is wrong rather than the screen.
        */
        <p className="text-xs text-destructive">
          This is not a web address that can be opened. Ask for it to be submitted again.
        </p>
      )}
    </div>
  );
}
