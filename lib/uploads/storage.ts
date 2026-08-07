import "server-only";

import { StorageClient } from "@supabase/storage-js";
import { randomUUID } from "node:crypto";

import { MAX_UPLOAD_BYTES, safeDownloadName } from "./file-types";

/**
 * Where an uploaded submission lives, and who can reach it.
 *
 * **The bucket is private and has no policies for `anon` or `authenticated`, so the browser
 * cannot read or write it at all.** Every access goes through this module, which holds the
 * service role key, and reaching a file means asking a procedure that authorizes the caller
 * for a signed URL that expires. That is the same posture the database has — `REVOKE ALL` plus
 * row level security with no policies, with Prisma connecting as the owner — and it is
 * deliberately stronger than per-student storage policies: a policy is a second description of
 * who may see what, and two descriptions can disagree. Here there is one, and it is procedure
 * code.
 *
 * The consequence to know: nothing can be fetched with supabase-js from the browser, and an
 * `<img src>` pointing at a stored object will not load. Both are correct — a student's
 * submission is not a public asset.
 */

export class UploadStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadStorageError";
  }
}

/**
 * One bucket for every kind of stored submission, not one per course or cohort.
 *
 * The path carries the submission id, so nothing is gained by splitting buckets and a
 * per-cohort bucket would be a provisioning step somebody has to remember at the start of
 * every term.
 */
export const SUBMISSION_UPLOAD_BUCKET = "submission-uploads";

/** How long a download link stays valid. */
export const SIGNED_URL_TTL_SECONDS = 60 * 5;

/**
 * How long an embedded preview's link stays valid, and why it is longer.
 *
 * A browser's built-in PDF viewer fetches a large document in ranges as the reader scrolls, so
 * the URL has to outlive the reading rather than the loading. Five minutes is ample to *open* a
 * PDF and not ample to read one — pages further in would silently fail to appear, which reads
 * as a corrupt file rather than as an expired link. Still short, and still one unguessable path.
 */
export const INLINE_PREVIEW_TTL_SECONDS = 60 * 30;

/**
 * The storage half of the service role client, which bypasses row level security by design.
 *
 * `StorageClient` rather than the whole of `createClient`, and for a better reason than
 * taste: `createClient` eagerly constructs a realtime client, which needs a global
 * `WebSocket` and therefore throws outright on Node 20. Nothing here wants realtime, a
 * Postgres connection, or auth — Prisma owns the database and this module owns one bucket —
 * so importing the piece that does the job avoids a dependency on the runtime's version.
 *
 * Constructed per call rather than held in a module global, matching `lib/supabase/server.ts`
 * and for the same reason: on Fluid Compute an instance is reused across concurrent requests,
 * and a client cached at module scope is shared state between them.
 */
export function storageClient(): StorageClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new UploadStorageError(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required to store " +
      "or read an uploaded submission.",
    );
  }

  return new StorageClient(`${url}/storage/v1`, {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  });
}

/**
 * The object key for one upload.
 *
 * Keyed by submission id, so a stored file is traceable back to the row that describes it
 * with no lookup table and no trust placed in a filename. **The student's own filename is
 * never part of the path** — it is theirs to choose, it can contain anything, and a path is
 * not the place to find out. It is kept in `submissions.upload_filename` instead, which is
 * what the instructor sees and what their browser calls the download.
 *
 * A generated segment rather than a fixed name, so re-uploading writes a new object instead of
 * overwriting the one an instructor may be part-way through reading.
 */
export function submissionUploadPath(params: {
  submissionId: string;
  extension: string;
}): string {
  return `${params.submissionId}/${randomUUID()}${params.extension}`;
}

/**
 * Stores the bytes and returns the path they went to.
 *
 * `upsert: false`, because the path contains a fresh UUID: a collision would mean something
 * is wrong that overwriting would hide.
 */
export async function storeSubmissionUpload(params: {
  submissionId: string;
  extension: string;
  contentType: string;
  bytes: ArrayBuffer | Buffer;
}): Promise<{ path: string }> {
  // Checked again here rather than trusting the caller. This is the last point before bytes
  // are written and it costs one comparison; the bucket's own limit is the guarantee behind it.
  if (params.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadStorageError(
      `That file is larger than the ${MAX_UPLOAD_BYTES} byte limit.`,
    );
  }

  const path = submissionUploadPath(params);
  const { error } = await storageClient()
    .from(SUBMISSION_UPLOAD_BUCKET)
    .upload(path, params.bytes, { contentType: params.contentType, upsert: false });

  if (error) {
    throw new UploadStorageError(
      `Could not store the upload for submission ${params.submissionId}: ${error.message}`,
    );
  }

  return { path };
}

/**
 * A link that downloads or displays one stored object, valid for a few minutes.
 *
 * Signed per request rather than stored, because a stored URL is a link that outlives the
 * authorization that produced it.
 *
 * **The disposition is the whole difference between the two uses.** Asking for a download sets
 * `Content-Disposition: attachment`, which is what makes the browser save the file under the
 * student's own name — the only reason that name crosses this boundary. An `inline` link omits
 * it, so the response carries the object's content type and nothing else, which is what lets a
 * PDF be embedded rather than downloaded. Supabase sets no `X-Frame-Options` and no CSP on
 * these responses, so an inline link can be framed; `verify:uploads` checks both halves of
 * that, since a change on their side would break the preview silently.
 */
export async function signedDownloadUrl(params: {
  path: string;
  filename?: string | null;
  /** `"inline"` for an embedded preview. Defaults to a download. */
  disposition?: "attachment" | "inline";
}): Promise<string> {
  const inline = params.disposition === "inline";

  const { data, error } = await storageClient()
    .from(SUBMISSION_UPLOAD_BUCKET)
    .createSignedUrl(
      params.path,
      inline ? INLINE_PREVIEW_TTL_SECONDS : SIGNED_URL_TTL_SECONDS,
      inline
        ? {}
        : { download: params.filename ? safeDownloadName(params.filename) : true },
    );

  if (error || !data?.signedUrl) {
    throw new UploadStorageError(
      `Could not sign a download link for ${params.path}: ${error?.message ?? "no URL returned"}`,
    );
  }

  return data.signedUrl;
}

/**
 * Whether the object is actually there.
 *
 * Used by the verification script, and worth having because "the row says there is a file"
 * and "there is a file" are different claims, and the second is the one an instructor cares
 * about when a download fails.
 */
export async function submissionUploadExists(path: string): Promise<boolean> {
  const lastSlash = path.lastIndexOf("/");
  const directory = lastSlash === -1 ? "" : path.slice(0, lastSlash);
  const name = path.slice(lastSlash + 1);

  const { data, error } = await storageClient()
    .from(SUBMISSION_UPLOAD_BUCKET)
    .list(directory, { search: name });

  if (error) return false;
  return (data ?? []).some((entry) => entry.name === name);
}

/** Removes one stored object. Used by the verification script and by course removal below. */
export async function removeSubmissionUpload(path: string): Promise<void> {
  const { error } = await storageClient()
    .from(SUBMISSION_UPLOAD_BUCKET)
    .remove([path]);

  if (error) {
    throw new UploadStorageError(`Could not remove ${path}: ${error.message}`);
  }
}

/**
 * Removes many stored objects, reporting the ones that would not go rather than throwing.
 *
 * For deleting a whole cohort, where the database rows are already gone by the time this runs
 * and throwing would turn "some files are still in the bucket" into "the operation failed". The
 * paths that survived are returned so they can be named, which is the only way anybody could
 * find them afterwards — the rows that pointed at them no longer exist.
 *
 * In batches, because a term's uploads can be hundreds of objects and Supabase takes a list.
 * A batch that errors is reported whole: the API does not say which of its paths failed, and
 * claiming to know would be worse than naming a few extra.
 */
export async function removeSubmissionUploads(
  paths: readonly string[],
): Promise<{ removed: number; leftBehind: string[] }> {
  const BATCH = 100;
  let removed = 0;
  const leftBehind: string[] = [];

  for (let start = 0; start < paths.length; start += BATCH) {
    const batch = paths.slice(start, start + BATCH);
    try {
      const { error } = await storageClient()
        .from(SUBMISSION_UPLOAD_BUCKET)
        .remove([...batch]);

      if (error) leftBehind.push(...batch);
      else removed += batch.length;
    } catch {
      // The bucket being unreachable is the same outcome as it refusing: the files are still
      // there and nothing else about the removal changes.
      leftBehind.push(...batch);
    }
  }

  return { removed, leftBehind };
}
