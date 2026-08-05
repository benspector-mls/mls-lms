/**
 * Creates the private bucket uploaded submissions live in.
 *
 * Run with `npm run setup:storage`, once per environment. Idempotent: it creates the bucket
 * if it is missing and otherwise reports what the existing one is configured with, so running
 * it against a project that already has it is a check rather than a no-op.
 *
 * Deliberately a script rather than something the application does on demand. Creating
 * infrastructure from a request path means the first student to upload provisions the bucket,
 * and a failure there is a failure of their submission.
 */
import { config as loadEnv } from "dotenv";

import {
  MAX_UPLOAD_BYTES,
  mimeTypesFor,
  UPLOAD_FILE_TYPE_KEYS,
  formatBytes,
} from "../lib/uploads/file-types";
import { storageClient, SUBMISSION_UPLOAD_BUCKET } from "../lib/uploads/storage";

loadEnv({ path: ".env.local", quiet: true });

async function main() {
  // The same client the application uses, so this script cannot provision a bucket the
  // application then fails to reach for a reason about credentials.
  const storage = storageClient();

  // Every MIME type any accepted file type allows. The bucket refuses anything else outright,
  // which is the backstop behind the route's own check — and the route's check is by extension
  // rather than MIME, deliberately, because browsers disagree about the same file. So this list
  // is generous where the route is exact.
  const allowedMimeTypes = mimeTypesFor(UPLOAD_FILE_TYPE_KEYS);

  const { data: existing } = await storage.getBucket(SUBMISSION_UPLOAD_BUCKET);

  if (existing) {
    console.log(`Bucket "${SUBMISSION_UPLOAD_BUCKET}" already exists.`);
    console.log(`  public:          ${existing.public}`);
    console.log(
      `  file size limit: ${existing.file_size_limit ?? "none"}` +
      (existing.file_size_limit ? ` (${formatBytes(Number(existing.file_size_limit))})` : ""),
    );
    console.log(`  allowed types:   ${existing.allowed_mime_types?.join(", ") ?? "any"}`);

    // Reported rather than silently corrected. A public bucket holding student submissions is
    // a disclosure problem, and one this script must not appear to have fixed when the fix is
    // a decision about live data.
    if (existing.public) {
      console.error(
        `\nThis bucket is PUBLIC, which would publish every submission in it. Make it private ` +
        `in the Supabase dashboard, or delete it and re-run this script if nothing has been ` +
        `uploaded yet.`,
      );
      process.exit(1);
    }

    const limit = Number(existing.file_size_limit ?? 0);
    if (limit !== MAX_UPLOAD_BYTES) {
      console.log(
        `\nUpdating the size limit from ${limit || "none"} to ${MAX_UPLOAD_BYTES} ` +
        `(${formatBytes(MAX_UPLOAD_BYTES)}) to match MAX_UPLOAD_BYTES.`,
      );
      const { error } = await storage.updateBucket(SUBMISSION_UPLOAD_BUCKET, {
        public: false,
        fileSizeLimit: MAX_UPLOAD_BYTES,
        allowedMimeTypes,
      });
      if (error) {
        console.error(`Could not update the bucket: ${error.message}`);
        process.exit(1);
      }
      console.log("Updated.");
    }

    console.log("\nNothing else to do.");
    return;
  }

  const { error } = await storage.createBucket(SUBMISSION_UPLOAD_BUCKET, {
    // The whole of the security question, and not the default. A public bucket would publish
    // every submission to anyone holding a URL.
    public: false,
    fileSizeLimit: MAX_UPLOAD_BYTES,
    allowedMimeTypes,
  });

  if (error) {
    console.error(`Could not create the bucket: ${error.message}`);
    process.exit(1);
  }

  console.log(`Created private bucket "${SUBMISSION_UPLOAD_BUCKET}".`);
  console.log(`  file size limit: ${MAX_UPLOAD_BYTES} (${formatBytes(MAX_UPLOAD_BYTES)})`);
  console.log(`  allowed types:   ${allowedMimeTypes.join(", ")}`);
  console.log(
    `\nNo policies were added for anon or authenticated, which is what keeps the browser out ` +
    `of it entirely. Every read goes through a server-signed URL.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
