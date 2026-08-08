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

/**
 * What a `FILE_UPLOAD` assignment may accept.
 *
 * **Each type maps its extensions to the content type they are stored under**, rather than
 * keeping two lists side by side. The two have to agree — the extension decides whether a file
 * is accepted, and the content type decides both what the bucket's allow-list permits and what
 * the browser is handed on the way back — and lists that agree by being written in the same
 * order agree until somebody adds one entry to one of them.
 */
export const UPLOAD_FILE_TYPES = {
  pdf: {
    label: "PDF",
    extensions: { ".pdf": "application/pdf" },
  },
  image: {
    label: "Images",
    extensions: {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
    },
  },
  document: {
    label: "Word and plain text",
    extensions: {
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".doc": "application/msword",
      ".txt": "text/plain",
      ".md": "text/markdown",
    },
  },
  spreadsheet: {
    label: "Spreadsheets",
    extensions: {
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xls": "application/vnd.ms-excel",
      ".csv": "text/csv",
    },
  },
  /**
   * A notebook is JSON, and `application/x-ipynb+json` is what Jupyter registers for it.
   *
   * The type stored is this one whatever the browser said, which for `.ipynb` is almost never
   * this: browsers report it as `application/json`, as `application/octet-stream`, or as
   * nothing at all. Admitting those to the bucket's allow-list would admit every JSON file and
   * then every file, which is why the content type is decided here rather than accepted.
   */
  notebook: {
    label: "Jupyter notebooks",
    extensions: { ".ipynb": "application/x-ipynb+json" },
  },
} as const satisfies Record<string, { label: string; extensions: Record<string, string> }>;

export type UploadFileTypeKey = keyof typeof UPLOAD_FILE_TYPES;

export const UPLOAD_FILE_TYPE_KEYS = Object.keys(UPLOAD_FILE_TYPES) as UploadFileTypeKey[];

export function isUploadFileTypeKey(value: string): value is UploadFileTypeKey {
  return Object.hasOwn(UPLOAD_FILE_TYPES, value);
}

/** The extensions one type accepts, in the order they are written. */
export function extensionsOf(key: UploadFileTypeKey): string[] {
  return Object.keys(UPLOAD_FILE_TYPES[key].extensions);
}

/** Every MIME type any accepted type allows. The bucket's own allow-list is built from this. */
export function mimeTypesFor(acceptedTypes: readonly string[]): string[] {
  return [
    ...new Set(
      acceptedTypes
        .filter(isUploadFileTypeKey)
        .flatMap((key) => Object.values(UPLOAD_FILE_TYPES[key].extensions)),
    ),
  ];
}

/** What a file input's `accept` attribute should hold. Extensions, for the reason below. */
export function acceptAttributeFor(acceptedTypes: readonly string[]): string {
  return [
    ...new Set(acceptedTypes.filter(isUploadFileTypeKey).flatMap(extensionsOf)),
  ].join(",");
}

/**
 * The content type a file with this extension is stored under, or null for one nothing accepts.
 *
 * **What the browser said is not consulted**, for the same reason `checkUpload` goes by
 * extension: browsers disagree about the same file, so a `.docx` arriving as
 * `application/octet-stream` on one student's machine would be stored under a type the bucket's
 * allow-list does not contain — accepted by the route and refused by the bucket, on that
 * student's machine and no other. Deciding it here means the only types ever stored are the
 * ones `mimeTypesFor` put on the allow-list.
 */
export function contentTypeFor(extension: string): string | null {
  const lowered = extension.toLowerCase();
  for (const key of UPLOAD_FILE_TYPE_KEYS) {
    const found = (UPLOAD_FILE_TYPES[key].extensions as Record<string, string>)[lowered];
    if (found) return found;
  }
  return null;
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

/**
 * What a browser can display in place, rather than only download.
 *
 * Decided from the extension rather than the stored content type, for the same reason
 * `checkUpload` is: the content type is what the browser claimed at upload time, and a `.pdf`
 * that arrived as `application/octet-stream` on one student's machine would be the one
 * submission an instructor still has to download.
 *
 * Word documents, spreadsheets, and notebooks are absent because no browser renders one. They
 * are downloaded, which is the honest answer rather than an empty frame. A notebook is the one
 * that costs something — it is the most-read of these and the download-and-open-elsewhere loop
 * that embedding a PDF exists to remove is exactly what a grader is left with. Rendering one is
 * a real dependency and its own decision.
 */
export function previewKindOf(filename: string): "pdf" | "image" | null {
  const extension = extensionOf(filename);
  if (extension === null) return null;
  if (extension === ".pdf") return "pdf";
  if (Object.hasOwn(UPLOAD_FILE_TYPES.image.extensions, extension)) return "image";
  return null;
}

export type UploadCheck =
  | { ok: true; type: UploadFileTypeKey; extension: string; contentType: string }
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

  const type = accepted.find((key) => Object.hasOwn(UPLOAD_FILE_TYPES[key].extensions, extension));

  if (!type) {
    return {
      ok: false,
      reason: `This assignment accepts ${describeExtensions(accepted)}, and that is a ${extension} file.`,
    };
  }

  // Never null here: `type` was found by this extension being one of its keys.
  return { ok: true, type, extension, contentType: contentTypeFor(extension)! };
}

function describeExtensions(accepted: readonly UploadFileTypeKey[]): string {
  const extensions = [...new Set(accepted.flatMap(extensionsOf))];
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
