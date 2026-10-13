import { MAX_PART_BYTES, partFromUpload, withinTotal } from "@/lib/grade/document-parts";

/**
 * What an uploaded file becomes in the prompt, decided from the content type recorded at upload.
 *
 * The refusals are the cases worth holding: a file the model is handed as something it cannot
 * read produces a confident report about nothing, so the mapping has to say no by name rather
 * than pass everything through.
 */

const upload = (filename: string, contentType: string | null, bytes = Buffer.from("x")) => ({
  filename,
  contentType,
  bytes,
});

describe("partFromUpload", () => {
  it("hands a PDF to the model as a document", () => {
    const part = partFromUpload(upload("resume.pdf", "application/pdf"));
    expect(part).toMatchObject({ label: "resume.pdf", kind: "pdf", mediaType: "application/pdf" });
  });

  it("hands an image to the model as an image, keeping its type", () => {
    const part = partFromUpload(upload("shot.png", "image/png; charset=binary"));
    expect(part).toMatchObject({ kind: "image", mediaType: "image/png" });
  });

  it("puts text into the prompt as text", () => {
    const part = partFromUpload(upload("notes.md", "text/markdown", Buffer.from("# Hi")));
    expect(part).toEqual({ label: "notes.md", kind: "text", text: "# Hi" });
  });

  // A .docx is a zip of XML. Handed over as a document block it is not a document, and the
  // honest answer is to say so by name so the instructor grades it by hand.
  it("refuses a Word document by name", () => {
    const part = partFromUpload(
      upload(
        "essay.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    );
    expect(part).toMatchObject({ refused: { label: "essay.docx" } });
    expect("refused" in part && part.refused.reason).toContain("a Word document");
  });

  it("refuses a file with no recorded type rather than guessing", () => {
    const part = partFromUpload(upload("mystery", null));
    expect("refused" in part && part.refused.reason).toContain("unknown type");
  });

  it("refuses a file larger than one part may be", () => {
    const part = partFromUpload(
      upload("big.pdf", "application/pdf", Buffer.alloc(MAX_PART_BYTES + 1)),
    );
    expect("refused" in part && part.refused.reason).toContain("more than one file may be");
  });
});

describe("withinTotal", () => {
  it("counts attachments and not text", () => {
    expect(
      withinTotal([
        { label: "a", kind: "text", text: "x".repeat(1000) },
        { label: "b", kind: "pdf", mediaType: "application/pdf", data: Buffer.alloc(10) },
      ]),
    ).toBe(true);
  });
});
