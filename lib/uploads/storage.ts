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

/** How long an instructor's download link stays valid. */
export const SIGNED_URL_TTL_SECONDS = 60 * 5;

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
 * A link that opens or downloads one stored object, valid for a few minutes.
 *
 * Signed per request rather than stored, because a stored URL is a link that outlives the
 * authorization that produced it. `download` sets the filename the browser saves it as, which
 * is the only reason the student's own filename crosses this boundary.
 */
export async function signedDownloadUrl(params: {
  path: string;
  filename?: string | null;
}): Promise<string> {
  const { data, error } = await storageClient()
    .from(SUBMISSION_UPLOAD_BUCKET)
    .createSignedUrl(params.path, SIGNED_URL_TTL_SECONDS, {
      download: params.filename ? safeDownloadName(params.filename) : true,
    });

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

/** Removes one stored object. Only the verification script does this. */
export async function removeSubmissionUpload(path: string): Promise<void> {
  const { error } = await storageClient()
    .from(SUBMISSION_UPLOAD_BUCKET)
    .remove([path]);

  if (error) {
    throw new UploadStorageError(`Could not remove ${path}: ${error.message}`);
  }
}
