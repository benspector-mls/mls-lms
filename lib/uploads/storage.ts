import "server-only";

import { StorageClient } from "@supabase/storage-js";
import { randomUUID } from "node:crypto";

import { safeDownloadName } from "./file-types";

/**
 * Where an uploaded submission lives, and who can reach it.
 *
 * **The bucket is private and has no policies for `anon` or `authenticated`, so nothing the
 * browser holds gives it standing access.** Every act on it goes through this module, which
 * holds the service role key. That is the same posture the database has — `REVOKE ALL` plus
 * row level security with no policies, with Prisma connecting as the owner — and it is
 * deliberately stronger than per-student storage policies: a policy is a second description of
 * who may see what, and two descriptions can disagree. Here there is one, and it is procedure
 * code.
 *
 * **The browser does reach the bucket twice, and both times carrying something this module
 * signed.** Reading means asking a procedure that authorizes the caller for a download URL that
 * expires in minutes. Writing means asking one for an upload URL good for a single object — see
 * `signedUploadUrl`, which is also where the reason the bytes no longer come through a function
 * of ours is written down. Neither is a key and neither is a policy: each is one decision this
 * module already made, in a form that expires and covers nothing else.
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
export function submissionUploadPath(params: { submissionId: string; extension: string }): string {
  return `${params.submissionId}/${randomUUID()}${params.extension}`;
}

/**
 * A URL the browser may send one file to, and nothing else.
 *
 * **This is what lets a student hand in a file larger than 4.5MB.** Bytes used to travel to a
 * route handler and from there to the bucket, and the hop in between is a Vercel function, whose
 * request body may not exceed 4.5MB on any plan — so the 25MB the bucket accepts was unreachable
 * and a 6MB scan was refused by the platform before our own code ran. The browser sends the file
 * straight here instead, and the two halves of the hand-in — asking permission and recording what
 * arrived — carry only JSON.
 *
 * **What the browser is trusted with, exactly.** The token Supabase returns is signed and says
 * `{ url: "<bucket>/<this one path>", upsert: false, scope: "upload" }`, expiring in two hours.
 * It writes that one object once: a second attempt on the same path is refused as a duplicate, a
 * different path fails the signature, and it reads nothing — not the object it just wrote, not
 * the bucket's listing, not a database row. So it is a capability rather than a credential, and
 * the authorization it stands for is `assertCanHandIn`, which ran on the server before this was
 * minted. The service role key never leaves this module.
 *
 * **The bucket still refuses what it always refused.** Its own size limit and its allow-list of
 * content types are enforced on this upload exactly as on a server-side one — a body over the
 * limit comes back `413 EntityTooLarge` and a disallowed type `415 InvalidMimeType`, with nothing
 * stored either way. That is what makes moving the transfer to the browser safe rather than
 * merely convenient: the guarantee was never in our code, it was always here.
 */
export async function signedUploadUrl(params: { path: string }): Promise<{ url: string }> {
  const { data, error } = await storageClient()
    .from(SUBMISSION_UPLOAD_BUCKET)
    .createSignedUploadUrl(params.path);

  if (error || !data?.signedUrl) {
    throw new UploadStorageError(
      `Could not sign an upload for ${params.path}: ${error?.message ?? "no URL returned"}`,
    );
  }

  return { url: data.signedUrl };
}

/**
 * What the bucket holds at one path, or null when it holds nothing there.
 *
 * **Read from storage rather than believed from the browser**, which is the point of it. The size
 * and the content type are written into the submission row and shown to an instructor, and after
 * the transfer moved to the browser the only honest source for both is the object itself. A
 * student's own report of what they uploaded is a claim; this is the fact.
 *
 * Null rather than an exception for a missing object, because "the upload never finished" is an
 * ordinary thing to have happened — a closed tab, a dropped connection — and the caller answers
 * it with a sentence rather than a stack trace.
 */
export async function uploadedObjectInfo(
  path: string,
): Promise<{ sizeBytes: number; contentType: string } | null> {
  const { data, error } = await storageClient().from(SUBMISSION_UPLOAD_BUCKET).info(path);

  if (error || !data) return null;
  if (typeof data.size !== "number" || typeof data.contentType !== "string") return null;

  return { sizeBytes: data.size, contentType: data.contentType };
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
      inline ? {} : { download: params.filename ? safeDownloadName(params.filename) : true },
    );

  if (error || !data?.signedUrl) {
    throw new UploadStorageError(
      `Could not sign a download link for ${params.path}: ${error?.message ?? "no URL returned"}`,
    );
  }

  return data.signedUrl;
}

/**
 * The bytes of one stored object.
 *
 * For the code view, which needs the text itself rather than a link to it. The caller checks the
 * size it recorded at upload time *before* asking, because this reads the whole object into
 * memory and `MAX_INLINE_TEXT_BYTES` is far below what the bucket will hold.
 *
 * The service role key is what reaches the object, as everywhere else in this module, so the
 * authorization is the procedure that called this and there is no second description of it.
 */
export async function readSubmissionUpload(path: string): Promise<Buffer> {
  const { data, error } = await storageClient().from(SUBMISSION_UPLOAD_BUCKET).download(path);

  if (error || !data) {
    throw new UploadStorageError(`Could not read ${path}: ${error?.message ?? "no data returned"}`);
  }

  return Buffer.from(await data.arrayBuffer());
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

/**
 * Every object in the bucket, with the two facts that decide whether it is still wanted.
 *
 * For `reconcile:uploads`, and shaped by what that has to decide rather than by what the storage
 * API returns. The bucket is two levels deep by construction — `submissionUploadPath` writes
 * `<submission id>/<generated>.<extension>` and nothing else writes here — so this lists the
 * folders and then the objects inside each, which is the whole of the traversal.
 *
 * **Paged, because a listing silently stops at a limit.** Supabase returns 100 entries by default
 * and a reconciler that read only the first hundred would report the rest as absent — which, for
 * a program that deletes what it does not recognise, is the one failure mode worth writing a loop
 * to avoid. It asks for pages until a short one comes back.
 *
 * `createdAt` is nullable because the API types it so. An object with no timestamp is treated by
 * the caller as too young to touch, which is the safe reading of not knowing how old something is.
 */
export async function listStoredUploads(): Promise<
  { path: string; sizeBytes: number; createdAt: Date | null }[]
> {
  const client = storageClient().from(SUBMISSION_UPLOAD_BUCKET);
  const PAGE = 100;

  const page = async (prefix: string, offset: number) => {
    const { data, error } = await client.list(prefix, { limit: PAGE, offset });
    if (error)
      throw new UploadStorageError(`Could not list ${prefix || "the bucket"}: ${error.message}`);
    return data ?? [];
  };

  const all = async (prefix: string) => {
    const entries = [];
    for (let offset = 0; ; offset += PAGE) {
      const batch = await page(prefix, offset);
      entries.push(...batch);
      if (batch.length < PAGE) return entries;
    }
  };

  const objects: { path: string; sizeBytes: number; createdAt: Date | null }[] = [];

  // A folder comes back with a null `id` and null timestamps; an object has both. That is how
  // the API distinguishes the two, and there is no other way to ask.
  for (const folder of (await all("")).filter((entry) => entry.id === null)) {
    for (const object of (await all(folder.name)).filter((entry) => entry.id !== null)) {
      objects.push({
        path: `${folder.name}/${object.name}`,
        sizeBytes: Number(object.metadata?.size ?? 0),
        createdAt: object.created_at ? new Date(object.created_at) : null,
      });
    }
  }

  return objects;
}

/** Removes one stored object. Used by the verification script and by course removal below. */
export async function removeSubmissionUpload(path: string): Promise<void> {
  const { error } = await storageClient().from(SUBMISSION_UPLOAD_BUCKET).remove([path]);

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
