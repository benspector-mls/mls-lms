/**
 * The Google document behind a submitted link, and the address it can be framed at.
 *
 * **A closed vocabulary, matched on the parsed host, rebuilt from the id.** The same three rules
 * `parseVideoUrl` follows, and here they are not merely tidy — they are what makes the frame work
 * at all. `drive.google.com/file/d/<id>/view`, which is what a student copies out of the address
 * bar for a PDF they keep in Drive, answers `x-frame-options: SAMEORIGIN` and cannot be framed;
 * its `/preview` sibling carries no such header. So the address a student hands in is frequently
 * the one shape that will not render, and the only way to a frame is to take the id out and build
 * a different address from it.
 *
 * **Nothing here talks to Google.** No credential, no request, no Drive API. The frame is a page
 * the instructor's own browser fetches, which is the arrangement the whole Drive story in this
 * application already rests on — see `copyUrlFromTemplate` in `lib/assignments/spec.ts`, which
 * distributes an assignment by rewriting a URL and letting Google's own copy prompt do the work.
 *
 * Deliberately separate from `GOOGLE_DRIVE_URL` in `lib/assignments/spec.ts`, and the two must not
 * be merged. That regex validates a URL an *instructor* typed into a field, refuses loudly so the
 * mistake is reported where it was made, and exists so `copyUrlFromTemplate`'s substitution always
 * has a trailing segment to substitute. This parser reads a URL a *student* pasted, refuses
 * quietly because a refusal here means "show the link card instead", and ignores the trailing
 * segment entirely. Widening that regex to match this one's tolerance would make the template
 * field accept a `/copy` URL, at which point every student is sent to the instructor's own file to
 * edit in place.
 */

/** The four kinds of Drive document this application can show, which is not all of Drive. */
export type DriveDocKind = "DOC" | "SHEET" | "SLIDES" | "DRIVE_FILE";

/** A recognised Drive document, as the two facts a frame address is built from. */
export type DriveDocRef = { kind: DriveDocKind; fileId: string };

/**
 * Which editor a `docs.google.com` path names.
 *
 * Three editors, named, rather than any `docs.google.com` address. They build their URLs the same
 * way and take `/preview` the same way, which is what makes them one kind rather than three.
 * Widening to every path under that host would admit a Form, a Drawing, a published `/pub`
 * snapshot and a folder listing, none of which have a framable preview at the address this
 * builds — and every one of which would fail silently inside the frame rather than falling back
 * to the link card, which is the visible, honest thing to do with an address we do not recognise.
 */
const DOCS_EDITORS: Record<string, DriveDocKind> = {
  document: "DOC",
  spreadsheets: "SHEET",
  presentation: "SLIDES",
};

/**
 * A Drive file id, checked rather than trusted.
 *
 * The id is interpolated straight into the frame's address, so without this a path segment of
 * `..` would travel there intact — the same reason `isYouTubeId` exists. The lower bound refuses
 * a truncated paste and, more usefully, refuses the published-document id space: in
 * `docs.google.com/document/d/e/2PACX-…/pub` the segment after `d` is the literal `e`, so a
 * reader that trusted its position would build a frame address for a document that does not
 * exist. The upper bound refuses an id-shaped string long enough to be something else.
 */
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * The document behind a submitted URL, or null when this application does not recognise one.
 *
 * **Everything after the id is ignored, which is the point rather than a shortcut.** A student
 * hands in `/edit`, `/edit?usp=sharing`, `/edit#slide=id.p`, `/view`, `/preview`, sometimes a bare
 * `/d/<id>`, and occasionally the instructor's own `/copy` or `/template/preview` link by mistake.
 * The trailing segment names the mode the pasted link happened to be in and carries nothing the
 * frame needs, so matching on the id alone covers all of those without enumerating them. It also
 * means the mistaken `/copy` paste still gets a frame — showing the instructor's template, which
 * is a far faster way to notice that mistake than reading the tail of a URL.
 *
 * Null is an ordinary answer and never an error. It is what a Canva board, a deployed site, a
 * Google Form or a folder gets, and the caller's job in that case is to draw the link card.
 */
export function parseDriveDocUrl(raw: string): DriveDocRef | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    // Not a URL at all: a bare path, or a filename, pasted into a box asking for a link.
    return null;
  }

  // http and https only. `javascript:` and `data:` parse perfectly well and are not documents,
  // and this address is about to become the `src` of a frame on a signed-in instructor's page.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  /*
    The parsed host, never a substring of the whole string. `https://evil.example/docs.google.com/
    document/d/x/edit` contains "docs.google.com" and is not Google.
  */
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (host === "docs.google.com") {
    const kind = DOCS_EDITORS[segments[0] ?? ""];
    // `d` is checked rather than skipped: `/document/u/0/d/<id>` and `/document/e/<id>` are
    // different shapes, and reading position 2 as the id regardless would take a segment that is
    // not one.
    if (!kind || segments[1] !== "d") return null;
    const fileId = segments[2] ?? "";
    return DRIVE_FILE_ID.test(fileId) ? { kind, fileId } : null;
  }

  if (host === "drive.google.com") {
    /*
      `file/d/<id>` only. `drive.google.com/open?id=<id>` is refused deliberately even though the
      id is right there: that shape is used for a folder, a native Doc and an uploaded file alike,
      and nothing in the URL says which — so there is no honest frame address to build from it.
      `drive.google.com/drive/folders/<id>` is refused because a folder is not a document.
    */
    if (segments[0] !== "file" || segments[1] !== "d") return null;
    const fileId = segments[2] ?? "";
    return DRIVE_FILE_ID.test(fileId) ? { kind: "DRIVE_FILE", fileId } : null;
  }

  return null;
}

/**
 * The address the frame loads, built from the stored kind and id and never from what was pasted.
 *
 * **`/edit` is never framed, and the reason is not a header.** An anonymous request to `/edit`
 * answers 200 with no frame restriction; it is refused because it is the *editor*. Framing it
 * invites an instructor to type into a student's submitted work in place, with no record that it
 * happened and no way for the student to tell their own edit from their grader's. `/preview` is
 * read-only by virtue of the address rather than by anybody's restraint. Two lesser reasons
 * follow: an editor needs the reader's Google session, which a third-party frame increasingly
 * does not have now that browsers partition storage by site; and `/edit` is where the pasted
 * string's `?usp=sharing` and `#slide=id.p` tail lives.
 *
 * **Slides gets `/embed` rather than `/preview`**, and both are framable — the difference is what
 * they draw. `/preview` gives a scrolling read-only page; `/embed` gives the deck as a player
 * sized to the frame, with next and previous controls and a slide counter, which is what paging
 * through a student's deck in a fixed-height box actually wants. `start=false` and `loop=false`
 * because a grading pane must not become a moving thing the moment it opens. `delayms` is only
 * consulted when `start` is true and is written anyway, so that a later change to `start` cannot
 * quietly introduce autoplay along with it.
 *
 * There is no counterpart to `videoWatchUrl` here, and that divergence is deliberate. The link
 * beside the frame keeps pointing at the address the student pasted, because a submitted URL is
 * evidence of what they handed in — an instructor checking whether they got the template rather
 * than their own copy needs the exact string. A resource URL is authored, and normalising it is a
 * kindness; a submitted URL is not, and normalising it destroys the thing `SubmittedLinkRow`
 * exists to show.
 */
export function driveEmbedUrl(ref: DriveDocRef): string {
  switch (ref.kind) {
    case "DOC":
      return `https://docs.google.com/document/d/${ref.fileId}/preview`;
    case "SHEET":
      return `https://docs.google.com/spreadsheets/d/${ref.fileId}/preview`;
    case "SLIDES":
      return `https://docs.google.com/presentation/d/${ref.fileId}/embed?start=false&loop=false&delayms=60000`;
    case "DRIVE_FILE":
      return `https://drive.google.com/file/d/${ref.fileId}/preview`;
  }
}

/** What to call the thing in the frame, for a title an assistive reader announces. */
export const DRIVE_DOC_KIND_LABEL: Record<DriveDocKind, string> = {
  DOC: "Google Doc",
  SHEET: "Google Sheet",
  SLIDES: "Google Slides deck",
  DRIVE_FILE: "file in Google Drive",
};
