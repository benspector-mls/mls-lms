"use client";

import * as React from "react";
import { ChevronRight, ExternalLink } from "lucide-react";

import { Markdown } from "@/components/markdown";
import { ResourceKindIcon } from "@/components/status-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ResourceKind, VideoProvider } from "@/lib/generated/prisma/enums";
import { videoEmbedUrl, videoWatchUrl } from "@/lib/resources/spec";

/**
 * One resource as a student meets it.
 *
 * The whole of the reading experience, and shared rather than written per screen so a note
 * opens the same way wherever it appears. Nothing here is graded, nothing is submitted, and
 * there is no state to be in — which is why this component takes no submission, no status, and
 * no callbacks.
 *
 * Three shapes for three kinds. They are genuinely different things to read, so they are
 * genuinely different rows: a link is one line you click away from, a note is prose you open in
 * place, and a video is a player. Forcing one row shape onto all three would mean a note whose
 * only affordance is a link to nowhere.
 *
 * **The instructor's Curriculum screen renders this same component**, with its actions menu passed
 * in as `actions`. That is the point rather than a convenience: an instructor asking what their
 * cohort will read should be reading the thing itself, and a second rendering built for their side
 * of the application would be a second answer to that question — one that could drift from the
 * real one without anybody noticing.
 */

export type ResourceView = {
  id: string;
  kind: ResourceKind;
  title: string;
  url: string | null;
  description: string | null;
  body: string | null;
  videoProvider: VideoProvider | null;
  videoId: string | null;
};

export function ResourceItem({
  resource,
  /**
   * Controls belonging to whoever is reading, drawn at the end of the row.
   *
   * Absent for a student, who has nothing to do to a resource but read it. Outside the row's own
   * markup rather than inside it, because a link's row *is* an anchor and a button nested in an
   * anchor is neither valid nor clickable — so the two sit side by side and the row keeps the
   * shape it has when nobody passes anything.
   */
  actions,
}: {
  resource: ResourceView;
  actions?: React.ReactNode;
}) {
  const row =
    resource.kind === "LINK" ? (
      <LinkResource resource={resource} />
    ) : resource.kind === "TEXT" ? (
      <TextResource resource={resource} />
    ) : (
      <VideoResource resource={resource} />
    );

  if (!actions) return row;

  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">{row}</div>
      {/*
        Aligned to the top rather than centred, so the menu stays beside the title when the row
        is opened onto a page of prose or a video player.
      */}
      <div className="flex shrink-0 items-center gap-2 pt-1.5 pr-2">{actions}</div>
    </div>
  );
}

/** A title, a line about it, and the address it opens. */
function LinkResource({ resource }: { resource: ResourceView }) {
  /*
    A row with no URL cannot happen — the schema requires one for this kind — but the column is
    nullable because three kinds share the table, so the narrowing has to be written somewhere.
    Rendering the title without a link is the honest fallback: it says something is here and
    does not print a dead control.
  */
  if (!resource.url) return <PlainRow resource={resource} />;

  return (
    <a
      href={resource.url}
      target="_blank"
      // noreferrer as well as noopener: these are addresses an instructor typed, and there is no
      // reason for a course page's URL to travel to them.
      rel="noopener noreferrer"
      className="group flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
    >
      <ResourceKindIcon kind={resource.kind} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium group-hover:underline">{resource.title}</span>
        {resource.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{resource.description}</p>
        )}
      </div>
      <ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

/**
 * Prose, opened in place rather than on its own page.
 *
 * Closed by default, because a module holding four notes would otherwise be a wall of text with
 * the assignments pushed off the screen — and the assignments are what a student came for. The
 * title is the summary; opening is one click.
 */
function TextResource({ resource }: { resource: ResourceView }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
        <ResourceKindIcon kind={resource.kind} className="mt-0.5" />
        <span className="min-w-0 flex-1 text-sm font-medium">{resource.title}</span>
        <ChevronRight
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/*
          The same renderer a student's feedback goes through, which is the reason this kind is
          markdown at all: a second content format would be a second renderer and a second set of
          rules about what may appear in it.
        */}
        <div className="px-3 pb-3 pl-10">
          <Markdown content={resource.body ?? ""} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A player, and a link to the video on its own site.
 *
 * The frame's address is built from the stored provider and id rather than from anything an
 * instructor typed — see `videoEmbedUrl`. That is what makes the vocabulary closed: this
 * component cannot be made to frame an arbitrary page, because it never receives one.
 */
function VideoResource({ resource }: { resource: ResourceView }) {
  const [open, setOpen] = React.useState(false);

  if (!resource.videoProvider || !resource.videoId) {
    return <PlainRow resource={resource} />;
  }

  const ref = { provider: resource.videoProvider, videoId: resource.videoId };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
        <ResourceKindIcon kind={resource.kind} className="mt-0.5" />
        <span className="min-w-0 flex-1 text-sm font-medium">{resource.title}</span>
        <ChevronRight
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2 px-3 pb-3 pl-10">
          {/*
            Mounted only once opened. Four collapsed videos in a module would otherwise be four
            player frames loading on page open, each of them a third-party script, on a page whose
            point is the assignment list above them.
          */}
          {open && (
            <div className="aspect-video w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-black">
              <iframe
                src={videoEmbedUrl(ref)}
                title={resource.title}
                className="size-full"
                // The narrowest set that still lets a player play, rather than the copy-pasted
                // list every embed snippet carries.
                allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          )}
          <a
            href={videoWatchUrl(ref)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:underline"
          >
            <ExternalLink aria-hidden="true" className="size-3" />
            Watch on {resource.videoProvider === "YOUTUBE" ? "YouTube" : "Vimeo"}
          </a>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A resource whose kind-specific columns are missing: the title, and nothing pretending to work.
 *
 * The icon still says which kind it was meant to be, which is the one useful thing about a row in
 * this state — it tells whoever fixes it what is missing.
 */
function PlainRow({ resource }: { resource: ResourceView }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <ResourceKindIcon kind={resource.kind} className="mt-0.5" />
      <span className="min-w-0 flex-1 text-sm font-medium">{resource.title}</span>
    </div>
  );
}
