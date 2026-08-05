/**
 * What a `FILE_UPLOAD` assignment may accept, and how big.
 *
 * A closed vocabulary rather than a text field, for the same reason the runner preset is a
 * select: a typo'd MIME type is not a validation error an instructor sees, it is a student
 * being told their correct file is the wrong kind, discovered on the due date. An instructor
 * ticks named types and the extensions follow.
 *
 * Pure — no database, no network, no `server-only` — so the form, the upload route, and the
 * verification script all check the same rule rather than three copies of it.
 */

/**
 * 25MB. Enforced in three places, and it has to be: the bucket refuses a larger object, the
 * route refuses it before storing anything, and the browser refuses it before spending a
 * student's upload on a request that cannot succeed. Only the first is a guarantee — the
 * other two exist so the failure is fast and legible.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const UPLOAD_FILE_TYPES = {
  pdf: {
    label: "PDF",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
  },
  image: {
    label: "Images",
    extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp"],
    mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  },
  document: {
    label: "Word and plain text",
    extensions: [".docx", ".doc", ".txt", ".md"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
      "text/markdown",
    ],
  },
} as const satisfies Record<
  string,
  { label: string; extensions: readonly string[]; mimeTypes: readonly string[] }
>;

export type UploadFileTypeKey = keyof typeof UPLOAD_FILE_TYPES;

export const UPLOAD_FILE_TYPE_KEYS = Object.keys(UPLOAD_FILE_TYPES) as UploadFileTypeKey[];

export function isUploadFileTypeKey(value: string): value is UploadFileTypeKey {
  return Object.hasOwn(UPLOAD_FILE_TYPES, value);
}

/** Every MIME type any accepted type allows. The bucket's own allow-list is built from this. */
export function mimeTypesFor(acceptedTypes: readonly string[]): string[] {
  return [
    ...new Set(
      acceptedTypes
        .filter(isUploadFileTypeKey)
        .flatMap((key) => [...UPLOAD_FILE_TYPES[key].mimeTypes]),
    ),
  ];
}

/** What a file input's `accept` attribute should hold. Extensions, for the reason below. */
export function acceptAttributeFor(acceptedTypes: readonly string[]): string {
  return [
    ...new Set(
      acceptedTypes
        .filter(isUploadFileTypeKey)
        .flatMap((key) => [...UPLOAD_FILE_TYPES[key].extensions]),
    ),
  ].join(",");
}

/** "PDF or Images", for telling a student what they may hand in. */
export function describeAcceptedTypes(acceptedTypes: readonly string[]): string {
  const labels = acceptedTypes.filter(isUploadFileTypeKey).map((key) => UPLOAD_FILE_TYPES[key].label);
  if (labels.length === 0) return "nothing yet";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/**
 * The extension, lowercased, or null when there is none.
 *
 * The **last** dot decides, which is the point: `resume.pdf.exe` is an executable and
 * matching on "contains .pdf" would accept it.
 */
export function extensionOf(filename: string): string | null {
  const match = /\.[A-Za-z0-9]+$/.exec(filename.trim());
  return match ? match[0].toLowerCase() : null;
}

export type UploadCheck =
  | { ok: true; type: UploadFileTypeKey; extension: string }
  | { ok: false; reason: string };

/**
 * Whether this file may be stored for this assignment.
 *
 * **The extension is the authority and the browser's reported MIME type is not consulted.**
 * Browsers disagree about the same file — a .docx arrives as its official type, as
 * `application/octet-stream`, or as nothing at all depending on the operating system and
 * whether Word is installed — so a MIME check refuses correct work on some students'
 * machines and not others, which is the worst kind of rule. The extension is what the
 * student sees and what the instructor opens.
 *
 * This is not a security boundary and is not meant to be one. Nothing executes, unpacks, or
 * parses an uploaded file; it is stored in a private bucket and handed back to an instructor
 * through a signed link. The check exists so an assignment asking for one PDF gets PDFs.
 */
export function checkUpload(params: {
  filename: string;
  sizeBytes: number;
  acceptedTypes: readonly string[];
}): UploadCheck {
  const accepted = params.acceptedTypes.filter(isUploadFileTypeKey);

  if (accepted.length === 0) {
    return {
      ok: false,
      reason:
        "This assignment does not say what kind of file it accepts, so there is nothing to " +
        "check against. Ask your instructor to set that on the assignment.",
    };
  }

  if (params.sizeBytes <= 0) {
    return { ok: false, reason: "That file is empty." };
  }

  if (params.sizeBytes > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason:
        `That file is ${formatBytes(params.sizeBytes)}, and the limit is ` +
        `${formatBytes(MAX_UPLOAD_BYTES)}.`,
    };
  }

  const extension = extensionOf(params.filename);
  if (extension === null) {
    return {
      ok: false,
      reason:
        "That file has no extension, so there is no way to tell what it is. Rename it to " +
        `end in ${describeExtensions(accepted)}.`,
    };
  }

  const type = accepted.find((key) =>
    (UPLOAD_FILE_TYPES[key].extensions as readonly string[]).includes(extension),
  );

  if (!type) {
    return {
      ok: false,
      reason: `This assignment accepts ${describeExtensions(accepted)}, and that is a ${extension} file.`,
    };
  }

  return { ok: true, type, extension };
}

function describeExtensions(accepted: readonly UploadFileTypeKey[]): string {
  const extensions = [
    ...new Set(accepted.flatMap((key) => [...UPLOAD_FILE_TYPES[key].extensions])),
  ];
  if (extensions.length === 1) return extensions[0];
  return `${extensions.slice(0, -1).join(", ")} or ${extensions[extensions.length - 1]}`;
}

/** "2.4 MB". One decimal place, because "2.44140625 MB" tells a student nothing. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A filename safe to hand back in a `Content-Disposition`.
 *
 * The stored path never contains a student's filename — see `submissionUploadPath` — so this
 * is only about what the instructor's browser calls the file it downloads. Slashes, quotes,
 * and control characters come out; everything else is kept, because a student's name for
 * their own work is worth preserving.
 */
export function safeDownloadName(filename: string): string {
  const cleaned = filename
    .replace(/[/\\]/g, "-")
    .replace(/[\u0000-\u001F"]/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : "submission";
}
