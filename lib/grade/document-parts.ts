import { promptExclusionReason } from "./classify";

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

/**
 * The repository a GitHub link names, or null for any other link.
 *
 * Everything after `owner/repo` is dropped, so a link to a branch, a file, a commit or a pull
 * request names the repository it sits in. Fellows often copy the address of whatever page they
 * were looking at, and refusing that link would leave the instructor to find the repository by
 * hand. The default branch is what gets read, because that is the branch fellows are told to merge
 * their finished work into.
 */
export function parseGithubRepoUrl(url: string): { owner: string; repo: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null;

  const [owner, rawRepo] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !rawRepo) return null;

  const repo = rawRepo.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;
  return { owner, repo };
}

/**
 * Whether a link points somewhere on GitHub at all.
 *
 * Asked only of a link `parseGithubRepoUrl` refused, so that a link to an account's page is refused
 * for what it is. Without this it would fall through to the Google check and be
 * refused as "not a Google Doc", which sends the fellow looking for the wrong fix.
 */
export function isGithubUrl(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname;
    return host === "github.com" || host === "www.github.com";
  } catch {
    return false;
  }
}

/**
 * Files no model reads as text, refused by extension before they count against the limits below.
 * Checked first because a fellow's screenshots sit beside their code, and three of them would
 * otherwise spend the byte allowance before `main.py` is reached.
 */
const BINARY_FILE =
  /\.(png|jpe?g|gif|webp|bmp|ico|svg|pdf|zip|gz|tar|mp3|mp4|mov|wav|woff2?|ttf|otf|db|sqlite3?)$/i;

/**
 * At most this many files and this many bytes of one repository are read.
 *
 * A project a fellow builds is a few dozen files at most. The limits exist for the repository that
 * is not, such as one with a committed data set: without them, every file is a request to GitHub
 * and every byte is billed as input.
 */
export const MAX_REPO_FILES = 80;
export const MAX_REPO_BYTES = 400_000;

/**
 * Which files of a repository to read, and the ones refused by name.
 *
 * A file that `promptExclusionReason` rejects, such as anything under `.venv/`, is skipped without
 * a refusal: nobody wrote it, and a committed virtual environment would otherwise list thousands of
 * refusals. A file over `maxBytes`, or past either limit above, is refused by name so the
 * instructor knows the model did not read it.
 */
export function selectRepoFiles(
  files: { path: string; size: number }[],
  maxBytes: number,
): { kept: string[]; refused: Refusal[] } {
  const kept: string[] = [];
  const refused: Refusal[] = [];
  let bytes = 0;
  let overLimit = 0;

  for (const file of files) {
    if (promptExclusionReason(file.path) !== null) continue;
    if (BINARY_FILE.test(file.path)) {
      refused.push({ label: file.path, reason: "not a text file" });
      continue;
    }
    if (file.size > maxBytes) {
      refused.push({
        label: file.path,
        reason: `${Math.round(file.size / 1024)} KB is more than one file may be`,
      });
      continue;
    }
    if (kept.length >= MAX_REPO_FILES || bytes + file.size > MAX_REPO_BYTES) {
      overLimit += 1;
      continue;
    }
    kept.push(file.path);
    bytes += file.size;
  }

  if (overLimit > 0) {
    refused.push({
      label: `${overLimit} more ${overLimit === 1 ? "file" : "files"}`,
      reason: `only ${MAX_REPO_FILES} files and ${MAX_REPO_BYTES / 1000} KB of a repository are read`,
    });
  }
  return { kept, refused };
}

/** Whether the attachments together fit in one request. */
export function withinTotal(parts: DocumentPart[]): boolean {
  const total = parts.reduce(
    (sum, part) => sum + (part.kind === "text" ? 0 : part.data.byteLength),
    0,
  );
  return total <= MAX_TOTAL_BYTES;
}
