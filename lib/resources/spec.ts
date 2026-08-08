import { z } from "zod";

import type { ResourceKind, VideoProvider } from "@/lib/generated/prisma/enums";

/**
 * What a resource is, and what makes one valid.
 *
 * The same shape as `lib/assignments/spec.ts` and for the same reason: a discriminated union on
 * `kind` is what lets a column be "required for one kind, absent for the others" without a
 * `NOT NULL` that would force a reading to invent a video id. The columns stay nullable and the
 * requirement lives here, where it can name the kind it applies to.
 *
 * **No `server-only` import.** The authoring form is a client component and needs the labels,
 * the union, and the video recognizer — the last so that a bad URL is reported as it is typed
 * rather than only when the save is refused. Nothing here touches the database or a secret.
 */

/** Every kind the application implements. Exhaustive, so the compiler names what a new one breaks. */
export const IMPLEMENTED_RESOURCE_KINDS = ["LINK", "TEXT", "VIDEO"] as const;

export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  LINK: "Link",
  TEXT: "Note",
  VIDEO: "Video",
};

/** What each kind is for, shown beside the choice on the authoring form. */
export const RESOURCE_KIND_BLURB: Record<ResourceKind, string> = {
  LINK: "A reading, a reference, or anything else that lives at a URL.",
  TEXT: "Something written here, in markdown. Rendered the way feedback is.",
  VIDEO: "A YouTube or Vimeo video, played on the course page.",
};

const title = z.string().trim().min(1, "A resource needs a title.").max(200);

/*
  2000 characters, which is the same ceiling `submittedUrl` uses. Long enough for anything real
  and short enough that a pasted page of text is refused as what it is rather than stored as a
  URL nobody can open.
*/
const url = z.string().trim().url("That is not a URL.").max(2000);

/*
  `.strict()` on every branch, the same as `assignmentSpecSchema`. Zod's default is to strip an
  unknown key silently, and stripping here would let a caller send a link's fields under a note's
  kind and watch it save as something else — the bug ships, and the only symptom is a resource
  that is not what whoever made it thought. `resourceColumns` would null the stray column anyway,
  so this is not what keeps the row clean; it is what makes the caller's mistake visible.
*/
export const resourceSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("LINK"),
      title,
      url,
      /*
        Plain text and one line of it. This renders in a row beside the title, and a row is not a
        place for a heading or a list — which is exactly what a markdown field would invite.
        Something that wants formatting is a TEXT resource.
      */
      description: z.string().trim().max(500).nullable().default(null),
    })
    .strict(),
  z
    .object({
      kind: z.literal("TEXT"),
      title,
      body: z.string().trim().min(1, "A note needs something in it.").max(50_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("VIDEO"),
      title,
      url,
    })
    .strict(),
]);

export type ResourceSpec = z.infer<typeof resourceSpecSchema>;

/** A parsed video, or the reason the URL was not one. */
export type VideoRef = { provider: VideoProvider; videoId: string };

/**
 * The video behind a URL, or null when this application does not recognise it.
 *
 * **A closed vocabulary, and that is the whole point.** The alternative — accepting embed HTML
 * an instructor pastes — puts an arbitrary iframe on a page every student in the cohort opens,
 * and there is no version of checking that HTML which is easier than this. So a URL is matched
 * against the handful of shapes the two supported providers actually use, the id is taken out
 * of it, and the embed is built from the id. Anything unrecognised is refused at authoring
 * time, where an instructor can fix it, rather than rendered as a frame pointing somewhere
 * nobody checked.
 *
 * Matching is on the parsed host rather than on a substring of the string, because
 * `https://evil.example/youtube.com/watch?v=x` contains "youtube.com" and is not YouTube.
 */
export function parseVideoUrl(raw: string): VideoRef | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }

  // http and https only. A `javascript:` or `data:` URL parses perfectly well and is not a video.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    // The ordinary watch link, which is what somebody copies out of the address bar.
    if (segments[0] === "watch") {
      const id = parsed.searchParams.get("v");
      return id && isYouTubeId(id) ? { provider: "YOUTUBE", videoId: id } : null;
    }
    // What copying an embed or a short gives instead.
    if ((segments[0] === "embed" || segments[0] === "shorts" || segments[0] === "live") && segments[1]) {
      return isYouTubeId(segments[1]) ? { provider: "YOUTUBE", videoId: segments[1] } : null;
    }
    return null;
  }

  if (host === "youtu.be") {
    const id = segments[0];
    return id && isYouTubeId(id) ? { provider: "YOUTUBE", videoId: id } : null;
  }

  if (host === "vimeo.com") {
    /*
      The last all-digits segment, not the first. A Vimeo URL may be `/123456`, `/channels/x/123456`,
      or `/123456/abcdef` for an unlisted video — the numeric id is what identifies it in all three.
    */
    const id = [...segments].reverse().find((segment) => /^\d+$/.test(segment));
    return id ? { provider: "VIMEO", videoId: id } : null;
  }

  if (host === "player.vimeo.com") {
    if (segments[0] === "video" && segments[1] && /^\d+$/.test(segments[1])) {
      return { provider: "VIMEO", videoId: segments[1] };
    }
    return null;
  }

  return null;
}

/**
 * YouTube ids are 11 characters of the URL-safe base64 alphabet.
 *
 * Checked rather than trusted, because the id goes straight into the embed address: without it
 * a path segment of `../../anything` would travel there intact.
 */
function isYouTubeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

/**
 * The address of the player frame, built from the stored provider and id.
 *
 * Never from a string an instructor typed — that is the difference between a closed vocabulary
 * and a promise about one.
 */
export function videoEmbedUrl(ref: VideoRef): string {
  return ref.provider === "YOUTUBE"
    ? `https://www.youtube-nocookie.com/embed/${ref.videoId}`
    : `https://player.vimeo.com/video/${ref.videoId}`;
}

/**
 * Where the video lives on its own site, for the link beside the frame.
 *
 * Rebuilt rather than the pasted URL, so that what an embed refuses to play cannot be opened by
 * a link this application printed either. Also normalises the twenty ways of writing the same
 * YouTube address down to one.
 */
export function videoWatchUrl(ref: VideoRef): string {
  return ref.provider === "YOUTUBE"
    ? `https://www.youtube.com/watch?v=${ref.videoId}`
    : `https://vimeo.com/${ref.videoId}`;
}

export const VIDEO_PROVIDER_LABEL: Record<VideoProvider, string> = {
  YOUTUBE: "YouTube",
  VIMEO: "Vimeo",
};

/**
 * A validated spec as the columns it is stored in.
 *
 * One function so that `create` and `update` cannot write a row two different ways, and so that
 * the columns a kind does not use are written as null rather than left holding whatever the
 * previous kind put there. That last part is what makes editing safe: nothing in the
 * application changes a resource's kind today, but a row carrying a stale `videoId` beside a
 * `LINK` would be a lie waiting for the first reader that trusts it.
 */
export function resourceColumns(spec: ResourceSpec): {
  kind: ResourceKind;
  title: string;
  url: string | null;
  description: string | null;
  body: string | null;
  videoProvider: VideoProvider | null;
  videoId: string | null;
} {
  const base = {
    title: spec.title,
    url: null,
    description: null,
    body: null,
    videoProvider: null,
    videoId: null,
  } as const;

  if (spec.kind === "LINK") {
    return { ...base, kind: "LINK", url: spec.url, description: spec.description };
  }

  if (spec.kind === "TEXT") {
    return { ...base, kind: "TEXT", body: spec.body };
  }

  const video = parseVideoUrl(spec.url);
  if (!video) {
    throw new UnrecognisedVideoError(spec.url);
  }

  return {
    ...base,
    kind: "VIDEO",
    url: videoWatchUrl(video),
    videoProvider: video.provider,
    videoId: video.videoId,
  };
}

/**
 * A video URL this application will not build an embed for.
 *
 * Its own error rather than a generic one, because the caller turns it into the message an
 * instructor reads and that message has to say which providers *are* recognised — "invalid URL"
 * on a perfectly good Loom link tells somebody nothing they can act on.
 */
export class UnrecognisedVideoError extends Error {
  constructor(public readonly url: string) {
    super(
      "That is not a YouTube or Vimeo video link. Paste the address from the video's own " +
        "page — those are the two services this application can embed.",
    );
    this.name = "UnrecognisedVideoError";
  }
}
