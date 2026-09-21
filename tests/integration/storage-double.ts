/**
 * The bucket, as a map, for the suites that record and read uploads.
 *
 * `npm run test:integration` runs against a disposable Postgres built from the migrations, which
 * has no Supabase Storage behind it, so this stands in for the bucket: `signedUploadUrl` hands out
 * an address, a test writes the bytes at it the way a browser's PUT would, and `uploadedObjectInfo`
 * reads back what is really there. What that establishes is every rule this application enforces —
 * which paths a caller may record, that the stored content type has to be the one the extension
 * means, that a removed row's object is removed with it. What it cannot establish is anything about
 * Supabase: that the bucket is private, that it refuses an oversized object, that its allow-list
 * holds every content type this build can store, and that a signed link and only a signed link
 * opens an object. Those are facts about an environment, and `npm run verify:uploads` is what asks
 * them.
 *
 * **Everything pure is the real module.** `jest.requireActual` is spread first, and only the calls
 * that would cross the network are replaced — each behaving the way Supabase does, including
 * refusing to sign a link for an object that is not there.
 *
 * Used as `jest.mock("../../lib/uploads/storage", () => jest.requireActual("./storage-double").storageDouble())`,
 * because `jest.mock` factories are hoisted above imports and may reach nothing but what they load
 * themselves.
 */

/** One stored object: the bytes, and the type they were stored under. */
export type StoredObject = { bytes: Buffer; contentType: string };
export type StoredObjects = Map<string, StoredObject>;

export function storageDouble() {
  const actual = jest.requireActual<typeof import("@/lib/uploads/storage")>(
    "../../lib/uploads/storage",
  );
  const objects: StoredObjects = new Map();

  return {
    ...actual,
    /** Reached from the tests as `bucket`, which is the only thing it is used as. */
    __objects: objects,
    signedUploadUrl: async ({ path }: { path: string }) => ({ url: `memory://upload/${path}` }),
    uploadedObjectInfo: async (path: string) => {
      const held = objects.get(path);
      return held ? { sizeBytes: held.bytes.byteLength, contentType: held.contentType } : null;
    },
    signedDownloadUrl: async ({ path }: { path: string }) => {
      if (!objects.has(path)) {
        throw new actual.UploadStorageError(`Could not sign a download link for ${path}`);
      }
      return `memory://download/${path}?token=signed-for-${encodeURIComponent(path)}`;
    },
    readSubmissionUpload: async (path: string) => {
      const held = objects.get(path);
      if (!held) throw new actual.UploadStorageError(`Could not read ${path}`);
      return held.bytes;
    },
    submissionUploadExists: async (path: string) => objects.has(path),
    removeSubmissionUpload: async (path: string) => {
      objects.delete(path);
    },
    /*
      The batch form, which goal and program deletion call. The real one never throws and reports
      what it could not remove; here nothing fails, so `leftBehind` is always empty.
    */
    removeSubmissionUploads: async (paths: string[]) => {
      for (const path of paths) objects.delete(path);
      return { removed: paths.length, leftBehind: [] as string[] };
    },
    /** What the reconciler walks: every object, with a size and a time old enough to judge. */
    listStoredUploads: async () =>
      [...objects.entries()].map(([path, held]) => ({
        path,
        sizeBytes: held.bytes.byteLength,
        createdAt: new Date(0),
      })),
  };
}
