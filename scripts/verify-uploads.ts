/**
 * The bucket a hand-in is stored in, and one real round trip through it.
 *
 * Run with `npm run verify:uploads`. Needs the bucket to exist — `npm run setup:storage` — and
 * stores and then removes three real objects.
 *
 * **What is left here is everything that is a fact about an environment rather than about this
 * repository.** The bucket being private, its size limit, its allow-list, and what a signed link
 * does and a public one does not are all settings on a Supabase project; they are not in this
 * checkout, they differ between the development project and the deployment, and they come apart the
 * moment a file type is added and `setup:storage` is not re-run somewhere. None of it can be asked
 * of a disposable local Postgres, which is why this script survives its own test suite.
 *
 * The rest of what this script used to hold — 104 of its 123 checks — has moved to where it runs on
 * every change:
 *
 * - `tests/lib/uploads/file-types.test.ts` and `tests/lib/uploads/storage.test.ts` hold the 64 pure
 *   checks — what may be handed in, the file-type map, the filename handling, what can be shown in
 *   place rather than downloaded, and the path bytes go to. They need nothing at all.
 * - `tests/integration/uploads.test.ts` holds the 39 that need the database: the two procedures a
 *   hand-in takes, what the browser is not trusted about, what a replacement removes and a released
 *   grade keeps, and who may read another fellow's file. Every row it needs it creates, so unlike
 *   this script it can never stand down for want of a suitably shaped course — which is what it used
 *   to do, quietly, on a freshly seeded database.
 *
 * The one check that moved nowhere counted the objects left in the bucket after the lifecycle's
 * transaction rolled back. Its subject was the rows this script no longer writes, and what it stood
 * for — a stored object really is gone once it is removed — is checked below on the round trip.
 *
 * **The allow-list is now compared against every content type this build can store**, rather than
 * only against the two the round trips store. Both are worth having: one reads what the bucket says
 * about itself and names every type missing, the other puts the same question to the thing that
 * actually enforces it.
 *
 * **A missing bucket is now a skip rather than a quiet finish.** Reporting "all checks passed" for a
 * run that stored nothing is the failure the harness's own `skip` exists to prevent, and this script
 * was making it: every check below the bucket lookup was abandoned with a `console.log` and a zero
 * exit code.
 */
import {
  contentTypeFor,
  MAX_UPLOAD_BYTES,
  mimeTypesFor,
  UPLOAD_FILE_TYPE_KEYS,
} from "../lib/uploads/file-types";
import {
  removeSubmissionUpload,
  signedDownloadUrl,
  signedUploadUrl,
  storageClient,
  submissionUploadExists,
  submissionUploadPath,
  SUBMISSION_UPLOAD_BUCKET,
} from "../lib/uploads/storage";
import { createChecker, loadEnvironment } from "./verify/harness";

loadEnvironment();

const { check, checkThat, skip, finish } = createChecker();

/**
 * Puts bytes in the bucket exactly the way a student's browser does.
 *
 * The server no longer stores anything itself — it signs an address and the browser sends the file
 * there — so a script that wrote through some other route would be testing a path nobody uses. This
 * is the real one: mint the address, PUT the bytes with the content type the server decided, and let
 * the bucket refuse what it refuses.
 */
const uploadAsBrowser = async (path: string, contentType: string, bytes: Buffer) => {
  const { url } = await signedUploadUrl({ path });
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: new Uint8Array(bytes),
  });

  if (!response.ok) {
    throw new Error(`the bucket refused the upload: ${response.status} ${await response.text()}`);
  }

  return { path };
};

async function main() {
  // --- the bucket itself ----------------------------------------------------
  const { data: bucket } = await storageClient().getBucket(SUBMISSION_UPLOAD_BUCKET);

  if (!bucket) {
    skip(
      `the "${SUBMISSION_UPLOAD_BUCKET}" bucket does not exist in this environment, so nothing ` +
        `below could be attempted. Run npm run setup:storage.`,
    );
    return finish();
  }

  // The whole of the security question. A public bucket would publish every submission in it to
  // anyone holding a URL, and a URL is not a secret.
  check("the bucket is private", bucket.public, false);
  check(
    "the bucket enforces the size limit itself, not only our code",
    Number(bucket.file_size_limit),
    MAX_UPLOAD_BYTES,
  );

  /*
    The allow-list, compared against every content type this build can store.

    The map's own consistency is a unit test — every extension has a content type, and every one of
    those is on the list `setup:storage` builds. What that cannot see is whether *this environment's*
    bucket was ever given that list. The round trips below catch the same drift for the two newest
    types by storing one of each; this catches it for all of them at once, and names the ones
    missing, because "some type is missing" is not a sentence anybody can act on.

    An empty list means the bucket accepts anything, which is drift in the other direction: the route
    checks by extension and the bucket is the backstop behind it, so a bucket refusing nothing is a
    backstop that is not there.
  */
  const allowed = new Set(bucket.allowed_mime_types ?? []);
  const missingTypes = mimeTypesFor(UPLOAD_FILE_TYPE_KEYS).filter((type) => !allowed.has(type));
  checkThat(
    "the bucket's allow-list holds every content type this build can store",
    allowed.size > 0 && missingTypes.length === 0,
    allowed.size === 0
      ? "the bucket accepts any type — run npm run setup:storage against this environment"
      : missingTypes.length > 0
        ? `${missingTypes.join(", ")} missing — run npm run setup:storage against this environment`
        : `${allowed.size} types allowed`,
  );

  // --- a real round trip ----------------------------------------------------
  const body = Buffer.from("%PDF-1.4 verify:uploads round trip\n");
  const stored = await uploadAsBrowser(
    submissionUploadPath({ submissionId: `verify-${Date.now()}`, extension: ".pdf" }),
    "application/pdf",
    body,
  );

  try {
    check("the object is there once stored", await submissionUploadExists(stored.path), true);

    const url = await signedDownloadUrl({ path: stored.path, filename: "round trip.pdf" });
    const fetched = await fetch(url);
    check("a signed link fetches it", fetched.status, 200);
    check(
      "...and the bytes are the same ones",
      Buffer.from(await fetched.arrayBuffer()).equals(body),
      true,
    );

    /*
      The point of a private bucket. The public URL for the same object must not work, or every
      signed link would be theatre over something already readable by anyone with the path.
    */
    const publicUrl = storageClient().from(SUBMISSION_UPLOAD_BUCKET).getPublicUrl(stored.path)
      .data.publicUrl;
    const unsigned = await fetch(publicUrl);
    check("the same object is not readable without a signature", unsigned.ok, false);

    // A tampered signature must not open it either, which is what says the token is verified
    // rather than merely present.
    const forged = new URL(url);
    const token = forged.searchParams.get("token") ?? "";
    forged.searchParams.set("token", `${token.slice(0, -6)}bad123`);
    const tampered = await fetch(forged.toString());
    check("a tampered signature does not open it", tampered.ok, false);

    /*
      The embedded preview rests on three properties of an inline link, none of which is ours to
      control: the response has to carry the object's content type, it must NOT carry an attachment
      disposition (which makes a browser download rather than display it), and it must not be
      frame-blocked. A change on Supabase's side would turn the instructor's PDF viewer into an empty
      box with no error, so it is checked rather than assumed.
    */
    const inlineUrl = await signedDownloadUrl({
      path: stored.path,
      filename: "round trip.pdf",
      disposition: "inline",
    });
    const inlineResponse = await fetch(inlineUrl);
    check("an inline link serves the object", inlineResponse.status, 200);
    check(
      "...as its own content type",
      inlineResponse.headers.get("content-type"),
      "application/pdf",
    );
    check(
      "...with no attachment disposition, so a browser displays it",
      inlineResponse.headers.get("content-disposition"),
      null,
    );
    check(
      "...and is not frame-blocked, which is what lets it be embedded",
      [
        inlineResponse.headers.get("x-frame-options"),
        inlineResponse.headers.get("content-security-policy"),
      ],
      [null, null],
    );

    // The download link is the opposite, and the filename it saves as is the student's own.
    check(
      "a download link still asks the browser to save it",
      (await fetch(url)).headers.get("content-disposition")?.startsWith("attachment"),
      true,
    );
  } finally {
    await removeSubmissionUpload(stored.path);
  }

  check("the object is gone once removed", await submissionUploadExists(stored.path), false);

  /*
    --- the bucket's allow-list, against the two newest types ------------------

    The failure the allow-list comparison above can only half see. That check reads what the bucket
    reports about itself; this stores a real object of each of the two newest types and reads it
    back, which is the same question put to the thing that actually enforces it.

    A notebook and a Python file because they are the newest and the least likely to have been on any
    allow-list by accident — `application/pdf` would pass this on a bucket configured years ago. This
    is the check that fails in an environment where `setup:storage` has not been re-run since a type
    was added: the route would accept the file and the bucket would refuse to store it, on a real
    student's hand-in and nowhere else.
  */
  const newest: [string, string, Buffer, string][] = [
    ["a notebook", ".ipynb", Buffer.from('{"cells": [], "nbformat": 4}\n'), "analysis.ipynb"],
    ["Python", ".py", Buffer.from("def main():\n    print('hello')\n"), "main.py"],
  ];

  for (const [label, extension, bytes, filename] of newest) {
    const contentType = contentTypeFor(extension)!;
    let object: { path: string } | null = null;

    try {
      object = await uploadAsBrowser(
        submissionUploadPath({ submissionId: `verify-${Date.now()}`, extension }),
        contentType,
        bytes,
      );
      checkThat(`the bucket stores ${label}`, true, contentType);
    } catch (err) {
      checkThat(
        `the bucket stores ${label}`,
        false,
        `${contentType} refused — run npm run setup:storage against this environment ` +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
    }

    if (object) {
      const response = await fetch(
        await signedDownloadUrl({ path: object.path, filename, disposition: "inline" }),
      );
      check(
        `...and hands ${label} back as itself`,
        response.headers.get("content-type"),
        contentType,
      );
      await removeSubmissionUpload(object.path);
    }
  }

  return finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
