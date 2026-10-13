/**
 * What a fellow handed in, as the parts a prompt can carry.
 *
 * A non-repository submission is links and files rather than a diff: a Google Doc, a Slides
 * deck, a PDF, a screenshot. Each becomes one part — text, which goes into the prompt as a
 * fenced block, or a PDF or an image, which goes beside the prompt as an attachment — or a
 * refusal that names the file and why, so the instructor is told what the model did not see.
 *
 * Pure, so it can be checked against a table of content types without a bucket or a model.
 */

export type DocumentPart =
  | { label: string; kind: "text"; text: string }
  | {
      label: string;
      kind: "pdf" | "image";
      mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/gif" | "image/webp";
      data: Buffer;
    };

export type Refusal = { label: string; reason: string };

/** Per attachment and in total, in bytes. The model's own limit on a request is 32 MB. */
export const MAX_PART_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 28 * 1024 * 1024;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/**
 * An uploaded file as a part, from the content type recorded when it was stored.
 *
 * A PDF and the four image types go to the model as they are. Text goes in as text, which
 * covers a markdown file, a `.txt`, a CSV and source code alike. Everything else is refused by
 * name: a `.docx` is a zip of XML the model cannot read as a document, and converting it is a
 * dependency this does not take on.
 */
export function partFromUpload(upload: {
  filename: string;
  contentType: string | null;
  bytes: Buffer;
}): DocumentPart | { refused: Refusal } {
  const label = upload.filename;
  const type = (upload.contentType ?? "").split(";")[0].trim().toLowerCase();

  if (upload.bytes.byteLength > MAX_PART_BYTES) {
    return {
      refused: {
        label,
        reason: `${Math.round(upload.bytes.byteLength / 1024 / 1024)} MB is more than one file may be`,
      },
    };
  }

  if (type === "application/pdf") {
    return { label, kind: "pdf", mediaType: "application/pdf", data: upload.bytes };
  }
  if ((IMAGE_TYPES as readonly string[]).includes(type)) {
    return {
      label,
      kind: "image",
      mediaType: type as (typeof IMAGE_TYPES)[number],
      data: upload.bytes,
    };
  }
  if (type.startsWith("text/") || type === "application/json") {
    return { label, kind: "text", text: upload.bytes.toString("utf-8") };
  }

  const named =
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ? "a Word document"
      : type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ? "a PowerPoint deck"
        : type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          ? "an Excel workbook"
          : type || "a file of unknown type";
  return {
    refused: {
      label,
      reason: `${named} cannot be read by the model; a PDF, an image, or a Google Doc can`,
    },
  };
}

/** Whether the attachments together fit in one request. */
export function withinTotal(parts: DocumentPart[]): boolean {
  const total = parts.reduce(
    (sum, part) => sum + (part.kind === "text" ? 0 : part.data.byteLength),
    0,
  );
  return total <= MAX_TOTAL_BYTES;
}
