/**
 * The path an uploaded submission is stored at.
 *
 * The one thing in `lib/uploads/storage.ts` that decides something from its arguments; everything
 * else in that module talks to Supabase and is checked by `npm run verify:uploads` against a real
 * bucket. These four cases came from that script, where they needed neither the bucket nor the
 * database and so ran every time it was run rather than every time the file changed.
 */
import { uploadPath } from "@/lib/uploads/storage";

describe("uploadPath", () => {
  const submissionId = "11111111-2222-3333-4444-555555555555";

  it("starts with the submission the file belongs to", () => {
    // Keyed by submission id, so a stored file is traceable back to the row describing it with no
    // lookup table and no trust placed in a filename.
    const path = uploadPath({ folder: submissionId, extension: ".pdf" });
    expect(path.startsWith(`${submissionId}/`)).toBe(true);
  });

  it("...and ends in the extension the check accepted", () => {
    expect(uploadPath({ folder: submissionId, extension: ".pdf" }).endsWith(".pdf")).toBe(true);
  });

  /*
    The student's filename is never in the path. It is theirs, it can contain anything, and a path
    is not where to find that out — it is kept in `submissions.upload_filename` instead, which is
    what the instructor's browser calls the download.
  */
  it("holds no part of the student's own filename", () => {
    expect(uploadPath({ folder: submissionId, extension: ".pdf" })).not.toContain("resume");
  });

  /*
    A generated segment rather than a fixed name, so handing in again writes a new object instead of
    overwriting the one an instructor may be part-way through reading.
  */
  it("gives two uploads of one submission different paths", () => {
    expect(uploadPath({ folder: submissionId, extension: ".pdf" })).not.toBe(
      uploadPath({ folder: submissionId, extension: ".pdf" }),
    );
  });
});
