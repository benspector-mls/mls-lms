import { MAX_UPLOAD_BYTES, formatBytes } from "./file-types";

/**
 * Sends one file to the address the server signed, reporting how far it has got.
 *
 * **`XMLHttpRequest` rather than `fetch`, for the one thing the old API can still do.** A student
 * handing in a 20MB scan over a home connection waits a while, and `fetch` cannot say how far a
 * request body has been sent — it reports when the response arrives and nothing before. So the
 * request that carries the file uses the API with an upload progress event, and the two small
 * calls on either side of it stay ordinary tRPC mutations.
 *
 * Wrapped in a promise so the caller reads as a sequence rather than as callbacks.
 *
 * Every rejection is a sentence for a student. The status codes it names are the bucket's own —
 * it refuses an oversized object and an unexpected type itself, which is what makes those
 * refusals worth translating rather than reporting as a number.
 */
export function sendFile(params: {
  url: string;
  contentType: string;
  file: File;
  onProgress: (percent: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", params.url);

    /*
      The type the server decided from the extension, not the one the browser guessed for the
      file. `beginUpload` sends it here for that reason, and `recordUpload` checks that the object
      really was stored under it — so this line is the courier and neither end takes it on trust.
    */
    request.setRequestHeader("content-type", params.contentType);

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        params.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) return resolve();

      if (request.status === 413) {
        return reject(
          new Error(
            `That file is ${formatBytes(params.file.size)}, and the limit is ` +
              `${formatBytes(MAX_UPLOAD_BYTES)}.`,
          ),
        );
      }

      reject(new Error("That upload did not go through. Try again."));
    });

    request.addEventListener("error", () =>
      reject(new Error("That upload did not go through — check your connection and try again.")),
    );

    request.addEventListener("abort", () =>
      reject(new Error("That upload stopped before it finished. Try again.")),
    );

    request.send(params.file);
  });
}
