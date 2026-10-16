/**
 * The file-type map, and every rule decided from a filename alone.
 *
 * Carries the pure half of `verify:uploads` alongside the cases this file already had. What is left
 * of that script is the bucket itself — that it is private, that it enforces the size limit, and
 * that its allow-list holds every content type this map can produce — which is a fact about an
 * environment rather than about this repository and cannot be asked here.
 */
import {
  acceptAttributeFor,
  checkUpload,
  contentTypeFor,
  describeAcceptedTypes,
  extensionOf,
  extensionsOf,
  formatBytes,
  isUploadFileTypeKey,
  MAX_UPLOAD_BYTES,
  mimeTypesFor,
  previewKindOf,
  safeDownloadName,
  UPLOAD_FILE_TYPE_KEYS,
  UPLOAD_FILE_TYPES,
} from "@/lib/uploads/file-types";

describe("extensionOf", () => {
  it("takes the last dot, so a double extension is what it ends in", () => {
    // The rule the whole check rests on. Matching "contains .pdf" would accept this.
    expect(extensionOf("resume.pdf.exe")).toBe(".exe");
  });

  it("lowercases", () => {
    expect(extensionOf("Resume.PDF")).toBe(".pdf");
  });

  it("is null for a file with no extension", () => {
    expect(extensionOf("resume")).toBeNull();
  });

  it("ignores surrounding whitespace", () => {
    expect(extensionOf("  resume.pdf  ")).toBe(".pdf");
  });

  it("is null for a name that is only a dot", () => {
    expect(extensionOf(".")).toBeNull();
  });

  // A dotfile is all extension, because the last dot is at the front. Nothing accepts `.gitignore`
  // as a type, so the answer costs nothing and saying it here records that it was considered.
  it("reads a dotfile's whole name as the extension", () => {
    expect(extensionOf(".gitignore")).toBe(".gitignore");
  });
});

describe("contentTypeFor", () => {
  it("decides the stored type from the extension, never from the browser", () => {
    /*
      A `.ipynb` almost never arrives as anything Jupyter would recognise — browsers report it
      as application/json, as application/octet-stream, or as nothing at all. Storing what the
      browser said would put a type on the object that the bucket's allow-list does not
      contain, on one student's machine and no other.
    */
    expect(contentTypeFor(".ipynb")).toBe("application/x-ipynb+json");
    expect(contentTypeFor(".docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("is case-insensitive", () => {
    expect(contentTypeFor(".PDF")).toBe("application/pdf");
    expect(contentTypeFor(".PY")).toBe("text/x-python");
  });

  it("is null for an extension nothing accepts", () => {
    expect(contentTypeFor(".exe")).toBeNull();
  });

  it("stores a spreadsheet as one", () => {
    expect(contentTypeFor(".xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  /*
    `text/x-python` rather than `text/plain`, which the `document` key already claims for `.txt`.
    An extension belonging to exactly one key is what the function below depends on.
  */
  it("stores a Python file as Python", () => {
    expect(contentTypeFor(".py")).toBe("text/x-python");
  });
});

/**
 * The invariant `verify:uploads` checks against a live bucket, held here as a fact about the map.
 *
 * Every extension having a content type is a fact about this repository. The bucket accepting
 * that content type is a fact about an environment, and the two come apart exactly when a type
 * is added and `setup:storage` is not re-run somewhere.
 */
describe("the map is internally consistent", () => {
  it("gives every extension of every type a content type", () => {
    for (const key of UPLOAD_FILE_TYPE_KEYS) {
      for (const extension of Object.keys(UPLOAD_FILE_TYPES[key].extensions)) {
        expect(contentTypeFor(extension)).not.toBeNull();
      }
    }
  });

  it("puts every one of those content types on the allow-list it builds", () => {
    const allowed = new Set(mimeTypesFor(UPLOAD_FILE_TYPE_KEYS));
    for (const key of UPLOAD_FILE_TYPE_KEYS) {
      for (const contentType of Object.values(UPLOAD_FILE_TYPES[key].extensions)) {
        expect(allowed.has(contentType)).toBe(true);
      }
    }
  });

  it("writes every extension with a leading dot and in lower case", () => {
    for (const key of UPLOAD_FILE_TYPE_KEYS) {
      for (const extension of Object.keys(UPLOAD_FILE_TYPES[key].extensions)) {
        expect(extension).toMatch(/^\.[a-z0-9]+$/);
      }
    }
  });

  /*
    An extension may belong to one type and no more, which `contentTypeFor` depends on rather than
    merely prefers: it returns the first key whose extensions contain the one it was given, so a
    second claim on the same extension is a stored content type decided by the order the table
    happens to be written in. Nothing in the types catches that, so this does — and the message
    names both keys, because "some extension is doubled" is not enough to act on.
  */
  it("gives no extension to two types", () => {
    const seen = new Map<string, string>();
    const doubled: string[] = [];

    for (const key of UPLOAD_FILE_TYPE_KEYS) {
      for (const extension of extensionsOf(key)) {
        const held = seen.get(extension);
        if (held) doubled.push(`${extension} is in both ${held} and ${key}`);
        else seen.set(extension, key);
      }
    }

    expect(doubled).toEqual([]);
  });

  it("gives a spreadsheet the three shapes one arrives in", () => {
    expect(extensionsOf("spreadsheet")).toEqual([".xlsx", ".xls", ".csv"]);
  });
});

describe("previewKindOf", () => {
  it("shows a PDF in place", () => {
    expect(previewKindOf("resume.pdf")).toBe("pdf");
  });

  it.each([".png", ".jpg", ".jpeg", ".gif", ".webp"])("shows a %s in place", (extension) => {
    expect(previewKindOf(`screenshot${extension}`)).toBe("image");
  });

  it.each([".docx", ".xlsx", ".csv", ".txt"])("downloads a %s rather than framing it", (ext) => {
    // No browser renders one, and an empty frame is a worse answer than a download.
    expect(previewKindOf(`work${ext}`)).toBeNull();
  });

  it("downloads a notebook, and that is deliberate", () => {
    // The one that costs something: it is the most-read of these, and rendering one is a real
    // dependency and its own decision. This case records that the answer is deliberate.
    expect(previewKindOf("analysis.ipynb")).toBeNull();
  });

  it("does not mind how the name was capitalised", () => {
    expect(previewKindOf("RESUME.PDF")).toBe("pdf");
  });

  /*
    Code is shown by the other of the two routes: read as text through `submissions.uploadText` and
    coloured here, rather than handed to a browser that has no viewer for it.
  */
  it.each(["main.py", "MAIN.PY"])("shows %s as code", (filename) => {
    expect(previewKindOf(filename)).toBe("code");
  });

  /*
    Markdown takes the same route as code and is rendered rather than coloured. Checked as its own
    kind so that returning "code" for everything `languageForPath` knows — which would colour a
    short response as source text — fails here.
  */
  it.each(["answers.md", "ANSWERS.MD"])("renders %s as Markdown", (filename) => {
    expect(previewKindOf(filename)).toBe("markdown");
  });

  it("shows a file with no extension in no way at all", () => {
    expect(previewKindOf("resume")).toBeNull();
  });
});

describe("checkUpload", () => {
  const pdfOnly = { acceptedTypes: ["pdf"] as const };

  it("accepts a file of an accepted type", () => {
    const result = checkUpload({ filename: "resume.pdf", sizeBytes: 1000, ...pdfOnly });
    expect(result).toEqual({
      ok: true,
      type: "pdf",
      extension: ".pdf",
      contentType: "application/pdf",
    });
  });

  it("refuses a file of a type this assignment does not accept", () => {
    const result = checkUpload({ filename: "screenshot.png", sizeBytes: 1000, ...pdfOnly });
    expect(result.ok).toBe(false);
  });

  it("refuses a double extension by what it actually ends in", () => {
    expect(checkUpload({ filename: "resume.pdf.exe", sizeBytes: 1000, ...pdfOnly }).ok).toBe(false);
  });

  it("accepts a file at exactly the limit", () => {
    expect(
      checkUpload({ filename: "resume.pdf", sizeBytes: MAX_UPLOAD_BYTES, ...pdfOnly }).ok,
    ).toBe(true);
  });

  it("refuses one byte over", () => {
    expect(
      checkUpload({ filename: "resume.pdf", sizeBytes: MAX_UPLOAD_BYTES + 1, ...pdfOnly }).ok,
    ).toBe(false);
  });

  it("refuses an empty file", () => {
    expect(checkUpload({ filename: "resume.pdf", sizeBytes: 0, ...pdfOnly }).ok).toBe(false);
  });

  it("refuses a file with no extension, because nothing says what it is", () => {
    expect(checkUpload({ filename: "resume", sizeBytes: 1000, ...pdfOnly }).ok).toBe(false);
  });

  it("refuses everything when the assignment accepts nothing", () => {
    // An assignment with an empty list is a configuration mistake, and the message says so
    // rather than telling the student their file is wrong.
    const result = checkUpload({ filename: "resume.pdf", sizeBytes: 1000, acceptedTypes: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("instructor");
  });

  it("ignores a type key it does not recognise", () => {
    const result = checkUpload({
      filename: "resume.pdf",
      sizeBytes: 1000,
      acceptedTypes: ["pdf", "not-a-type"],
    });
    expect(result.ok).toBe(true);
  });

  // And an assignment whose only key is unknown accepts nothing, rather than falling back to
  // accepting whatever arrived.
  it("refuses everything when the only key is one it does not recognise", () => {
    expect(
      checkUpload({ filename: "deck.key", sizeBytes: 1000, acceptedTypes: ["keynote"] }).ok,
    ).toBe(false);
  });

  it("does not mind how the file was capitalised", () => {
    expect(checkUpload({ filename: "RESUME.PDF", sizeBytes: 1000, ...pdfOnly }).ok).toBe(true);
  });

  // The sentence a student reads. It names what the assignment takes and what they sent, because
  // "that file is not accepted" leaves them to guess which of the two was wrong.
  it("says what the assignment takes and what the file is", () => {
    const result = checkUpload({ filename: "screenshot.png", sizeBytes: 1000, ...pdfOnly });
    expect(result).toEqual({
      ok: false,
      reason: "This assignment accepts .pdf, and that is a .png file.",
    });
  });

  it("accepts the same file where images are asked for", () => {
    expect(checkUpload({ filename: "screenshot.png", sizeBytes: 1000, acceptedTypes: ["image"] })) //
      .toEqual({ ok: true, type: "image", extension: ".png", contentType: "image/png" });
  });

  it("accepts a notebook where the assignment asks for one, and not where it does not", () => {
    expect(
      checkUpload({ filename: "mod-3.ipynb", sizeBytes: 2048, acceptedTypes: ["notebook"] }).ok,
    ).toBe(true);
    expect(checkUpload({ filename: "mod-3.ipynb", sizeBytes: 2048, ...pdfOnly }).ok).toBe(false);
  });

  // A CSV is a spreadsheet rather than plain text, because a spreadsheet is what asks for it.
  it("refuses a CSV where the assignment asks for Word and plain text", () => {
    expect(
      checkUpload({ filename: "data.csv", sizeBytes: 512, acceptedTypes: ["document"] }).ok,
    ).toBe(false);
  });

  it("accepts a Python file where the assignment asks for one", () => {
    expect(checkUpload({ filename: "main.py", sizeBytes: 512, acceptedTypes: ["python"] })).toEqual(
      {
        ok: true,
        type: "python",
        extension: ".py",
        contentType: "text/x-python",
      },
    );
  });

  /*
    The reason the key holds `.py` alone. An assignment asking for a Python script accepts Python
    scripts, by the same rule that ticking PDF does not also accept Word — so a `code` key holding
    every language would have been the wrong shape, however many fewer tick boxes it draws.
  */
  it("refuses JavaScript where the assignment asks for Python", () => {
    expect(checkUpload({ filename: "app.js", sizeBytes: 512, acceptedTypes: ["python"] }).ok).toBe(
      false,
    );
  });

  // The type the file will be stored under comes back with the acceptance, which is what
  // `beginUpload` hands the browser to send on the upload itself.
  it("hands back the content type the file will be stored under", () => {
    const result = checkUpload({
      filename: "analysis.ipynb",
      sizeBytes: 1024,
      acceptedTypes: ["notebook"],
    });
    expect(result.ok ? result.contentType : result.reason).toBe("application/x-ipynb+json");
  });
});

describe("mimeTypesFor", () => {
  it("deduplicates types two extensions share", () => {
    // .jpg and .jpeg are both image/jpeg, and the bucket's allow-list wants it once.
    const types = mimeTypesFor(["image"]);
    expect(types).toEqual([...new Set(types)]);
    expect(types).toContain("image/jpeg");
  });

  it("ignores an unrecognised key rather than throwing", () => {
    expect(mimeTypesFor(["pdf", "nonsense"])).toEqual(["application/pdf"]);
  });
});

describe("acceptAttributeFor", () => {
  it("lists extensions rather than MIME types", () => {
    expect(acceptAttributeFor(["pdf"])).toBe(".pdf");
  });

  it("joins several types without repeating an extension", () => {
    const attribute = acceptAttributeFor(["pdf", "image"]);
    expect(attribute.split(",")).toEqual([...new Set(attribute.split(","))]);
  });

  // The exact string the file input is given, because it is matched by the browser rather than
  // read by a person: every extension of every ticked type, in the order the map writes them.
  it("lists every extension of every type it was given", () => {
    expect(acceptAttributeFor(["pdf", "image"])).toBe(".pdf,.png,.jpg,.jpeg,.gif,.webp");
    expect(acceptAttributeFor(["python"])).toBe(".py");
  });

  it("writes a type named twice only once", () => {
    expect(acceptAttributeFor(["pdf", "pdf"])).toBe(".pdf");
  });

  it("contributes nothing for a key it does not recognise", () => {
    expect(acceptAttributeFor(["keynote"])).toBe("");
  });
});

describe("describeAcceptedTypes", () => {
  it("names one type", () => {
    expect(describeAcceptedTypes(["pdf"])).toBe("PDF");
  });

  it("joins two with 'or'", () => {
    expect(describeAcceptedTypes(["pdf", "image"])).toBe("PDF or Images");
  });

  it("joins three with commas and a final 'or'", () => {
    expect(describeAcceptedTypes(["pdf", "image", "notebook"])).toBe(
      "PDF, Images or Jupyter notebooks",
    );
  });

  it("says so when an assignment accepts nothing", () => {
    expect(describeAcceptedTypes([])).toBe("nothing yet");
  });

  // The labels themselves, which are what a student reads above the file input.
  it("names each type the way the student is told it", () => {
    expect(describeAcceptedTypes(["pdf", "image", "document"])).toBe(
      "PDF, Images or Word and plain text",
    );
    expect(describeAcceptedTypes(["python"])).toBe("Python");
  });
});

describe("safeDownloadName", () => {
  it("keeps a student's spaces, because it is their name for their own work", () => {
    expect(safeDownloadName("My Final Resume.pdf")).toBe("My Final Resume.pdf");
  });

  it("removes path separators", () => {
    // Each becomes a dash rather than being dropped, so what is left is still one filename rather
    // than several path segments run together.
    expect(safeDownloadName("../../etc/passwd")).toBe("..-..-etc-passwd");
  });

  // A newline would end the `Content-Disposition` header and start whatever came after it.
  it("removes a newline as well as a quote", () => {
    expect(safeDownloadName('re"su\nme.pdf')).toBe("resume.pdf");
  });

  it("removes quotes and control characters, which a header cannot carry", () => {
    expect(safeDownloadName('re"su me.pdf')).toBe("resume.pdf");
  });

  it("falls back to a name rather than returning nothing", () => {
    expect(safeDownloadName('  ""  ')).toBe("submission");
  });
});

describe("formatBytes", () => {
  it.each([
    [512, "512 bytes"],
    [2048, "2 KB"],
    [5 * 1024 * 1024, "5.0 MB"],
  ])("formats %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("gives one decimal place, because 2.44140625 MB tells a student nothing", () => {
    expect(formatBytes(2560000)).toBe("2.4 MB");
  });

  // The limit as a student is told it, which is the sentence the refusal above them is built from.
  it("reports the upload limit as 25.0 MB", () => {
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe("25.0 MB");
  });
});

describe("isUploadFileTypeKey", () => {
  it("recognises every key the map holds", () => {
    for (const key of UPLOAD_FILE_TYPE_KEYS) expect(isUploadFileTypeKey(key)).toBe(true);
  });

  it("refuses a key it does not", () => {
    expect(isUploadFileTypeKey("executable")).toBe(false);
  });

  it("is not fooled by an inherited property", () => {
    expect(isUploadFileTypeKey("constructor")).toBe(false);
    expect(isUploadFileTypeKey("toString")).toBe(false);
  });
});
