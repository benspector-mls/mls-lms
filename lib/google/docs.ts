import "server-only";

import { createHash, createSign } from "node:crypto";

import type { DriveDocKind, DriveDocRef } from "../drive/embed";

/**
 * Reading Google Docs, Slides and Drive files, two ways.
 *
 * **A public file is read with no credential at all.** A fellow's submission and an instructor's
 * exemplar are shared as "anyone with the link", and Google serves those at an export address
 * that needs no login: a Doc as markdown, a Slides deck as a PDF, an uploaded file as itself.
 * No Google account, no consent screen, no token.
 *
 * **A private file is read as the application's service account.** An answer key must not be
 * public — a key a fellow could open is not a key — so the instructor shares it with the service
 * account's email address, and the application signs itself in with the key in
 * `GOOGLE_SERVICE_ACCOUNT_KEY`. The sign-in is forty lines of standard JWT rather than a client
 * library, because two endpoints do not need a dependency: see `lib/slack/client.ts` for the
 * same decision.
 *
 * **"Readable" is decided from what came back, never from the status code.** Google answers a
 * request for a file that is not shared with a 200 and a sign-in page, so a check that trusted
 * the status would call every private file public. The export is accepted only when the
 * response is the content type asked for and the final address is still a Google export, not
 * `accounts.google.com`.
 */

export class GoogleDocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleDocError";
  }
}

/** What one read of a file produced, with enough to record what the model was shown. */
export type DocExport =
  | { kind: "text"; text: string; mediaType: "text/markdown" | "text/plain"; contentSha256: string }
  | { kind: "pdf"; data: Buffer; mediaType: "application/pdf"; contentSha256: string }
  | { kind: "image"; data: Buffer; mediaType: ImageMediaType; contentSha256: string };

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

const IMAGE_TYPES: ImageMediaType[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** A bound on what one document may put into a prompt, in bytes. */
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** The public export address for a Drive document of each kind, or null for one with none. */
export function publicExportUrl(ref: DriveDocRef, format: "md" | "txt" = "md"): string | null {
  switch (ref.kind) {
    case "DOC":
      return `https://docs.google.com/document/d/${ref.fileId}/export?format=${format}`;
    case "SLIDES":
      return `https://docs.google.com/presentation/d/${ref.fileId}/export/pdf`;
    case "DRIVE_FILE":
      return `https://drive.google.com/uc?export=download&id=${ref.fileId}`;
    case "SHEET":
      // A sheet is numbers in cells, and nothing in a rubric reads one. Refused by name.
      return null;
  }
}

/** What a reader expects to get back from each kind, so a sign-in page is told apart from it. */
const EXPECTED: Record<DriveDocKind, "text" | "pdf" | "file" | null> = {
  DOC: "text",
  SLIDES: "pdf",
  DRIVE_FILE: "file",
  SHEET: null,
};

/**
 * One public document's contents, read with no credential.
 *
 * A Doc is asked for as markdown first and plain text second: markdown keeps the headings and
 * tables a rubric or a reflection is written with, and the plain text is what a Doc that cannot
 * be exported as markdown still gives. Both are text to the prompt.
 */
export async function exportPublicDoc(ref: DriveDocRef): Promise<DocExport> {
  const expected = EXPECTED[ref.kind];
  if (expected === null) {
    throw new GoogleDocError(
      "A Google Sheet cannot be graded: nothing in a rubric reads a spreadsheet. Grade it by hand.",
    );
  }

  const url = publicExportUrl(ref)!;
  const response = await fetchPublic(url);

  if (ref.kind === "DOC") {
    if (!response) {
      // The markdown format is the newer of the two; a Doc that refuses it may still give text.
      const fallback = await fetchPublic(publicExportUrl(ref, "txt")!);
      if (!fallback) throw notPublic();
      const text = Buffer.from(fallback.body).toString("utf-8");
      return { kind: "text", text, mediaType: "text/plain", contentSha256: sha256(text) };
    }
    const text = Buffer.from(response.body).toString("utf-8");
    return { kind: "text", text, mediaType: "text/markdown", contentSha256: sha256(text) };
  }

  if (!response) throw notPublic();
  return classify(Buffer.from(response.body), response.contentType);
}

function notPublic(): GoogleDocError {
  return new GoogleDocError(
    "This document is not shared. Set it to “Anyone with the link can view” in Google's " +
      "Share dialog.",
  );
}

/**
 * A fetch of a public export that returns null for anything that is not the file: a sign-in
 * page, a Google error page, a redirect to the account chooser, or a non-200.
 */
async function fetchPublic(
  url: string,
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) return null;
  if (new URL(response.url).hostname === "accounts.google.com") return null;

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.startsWith("text/html")) return null;

  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_DOC_BYTES) {
    throw new GoogleDocError(
      `This file is ${Math.round(body.byteLength / 1024 / 1024)} MB, more than the ` +
        `${MAX_DOC_BYTES / 1024 / 1024} MB one document may be.`,
    );
  }
  return { body, contentType };
}

/** A downloaded file as something the model can be handed, or a refusal naming the type. */
function classify(data: Buffer, contentType: string): DocExport {
  const base = contentType.split(";")[0].trim();
  if (base === "application/pdf") {
    return { kind: "pdf", data, mediaType: "application/pdf", contentSha256: sha256(data) };
  }
  if ((IMAGE_TYPES as string[]).includes(base)) {
    return {
      kind: "image",
      data,
      mediaType: base as ImageMediaType,
      contentSha256: sha256(data),
    };
  }
  if (base.startsWith("text/")) {
    const text = data.toString("utf-8");
    return { kind: "text", text, mediaType: "text/plain", contentSha256: sha256(text) };
  }
  throw new GoogleDocError(
    `This file is ${base || "of an unknown type"}, which the model cannot read. A Google Doc, ` +
      `a Slides deck, a PDF or an image can be graded; grade anything else by hand.`,
  );
}

// =============================================================================================
// The service account, for private documents
// =============================================================================================

type ServiceAccount = { email: string; privateKey: string };

/**
 * The service account's identity, read from the environment on every call rather than at
 * import, so a process started before the variable was set — a test runner, a script — does not
 * hold a stale answer. Null when the variable is unset, which is how development runs.
 */
export function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;

  let parsed: { client_email?: unknown; private_key?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GoogleDocError(
      "GOOGLE_SERVICE_ACCOUNT_KEY is not the JSON Google issued for the service account.",
    );
  }
  if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
    throw new GoogleDocError("GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email or private_key.");
  }
  // Vercel stores the value with the newlines of the PEM block written as the two characters
  // backslash and n; the signer needs real newlines.
  return { email: parsed.client_email, privateKey: parsed.private_key.replace(/\\n/g, "\n") };
}

export function isServiceAccountConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
}

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** A token and when it stops working, kept per process so one grading run signs in once. */
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * An access token for the service account, through the two-step the OAuth 2.0 service account
 * flow specifies: sign a JWT naming the account and the scope with its private key, then trade
 * it for a token at Google's token endpoint. Cached until a minute before it expires.
 */
async function accessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned =
    `${encode({ alg: "RS256", typ: "JWT" })}.` +
    encode({ iss: account.email, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 });
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.privateKey, "base64url");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!response.ok) {
    throw new GoogleDocError(
      `Google refused the service account's sign-in (${response.status}). The key in ` +
        `GOOGLE_SERVICE_ACCOUNT_KEY may have been revoked, or the Drive API is not enabled on ` +
        `its project.`,
    );
  }
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return body.access_token;
}

/** What is recorded about a private document on the draft, beside its text. */
export type PrivateDocExport = {
  markdown: string;
  headRevisionId: string | null;
  modifiedTime: string | null;
  contentSha256: string;
};

/**
 * A private Google Doc's text as markdown, read as the service account.
 *
 * Two requests: the file's metadata, which is also the check that the account can see it at
 * all, and the export. A file the account cannot see answers 404 — Google says "not found"
 * rather than "not shared", so the message says what to do rather than what Google said.
 */
export async function exportPrivateDocMarkdown(fileId: string): Promise<PrivateDocExport> {
  const account = serviceAccount();
  if (!account) {
    throw new GoogleDocError(
      "GOOGLE_SERVICE_ACCOUNT_KEY is not set, so private documents cannot be read here.",
    );
  }
  const token = await accessToken(account);
  const headers = { authorization: `Bearer ${token}` };
  const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;

  const meta = await fetch(
    `${base}?fields=headRevisionId,modifiedTime,mimeType&supportsAllDrives=true`,
    { headers },
  );
  if (meta.status === 404 || meta.status === 403) {
    throw new GoogleDocError(
      `The service account cannot open this document. Share it with ${account.email} as a ` +
        `Viewer, then save again.`,
    );
  }
  if (!meta.ok) {
    throw new GoogleDocError(`Google answered ${meta.status} when asked about the document.`);
  }
  const about = (await meta.json()) as {
    headRevisionId?: string;
    modifiedTime?: string;
    mimeType?: string;
  };
  if (about.mimeType !== "application/vnd.google-apps.document") {
    throw new GoogleDocError(
      "An answer key has to be a Google Doc. Paste the link of a Doc rather than a " +
        `${about.mimeType ?? "file of another kind"}.`,
    );
  }

  const exported = await fetch(`${base}/export?mimeType=${encodeURIComponent("text/markdown")}`, {
    headers,
  });
  if (!exported.ok) {
    throw new GoogleDocError(`Google answered ${exported.status} when exporting the document.`);
  }
  const markdown = await exported.text();
  if (markdown.length > MAX_DOC_BYTES) {
    throw new GoogleDocError("This document is longer than one document may be.");
  }

  return {
    markdown,
    headRevisionId: about.headRevisionId ?? null,
    modifiedTime: about.modifiedTime ?? null,
    contentSha256: sha256(markdown),
  };
}
