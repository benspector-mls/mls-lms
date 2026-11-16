import {
  isGithubUrl,
  MAX_PART_BYTES,
  MAX_REPO_BYTES,
  MAX_REPO_FILES,
  parseGithubRepoUrl,
  partFromUpload,
  selectRepoFiles,
  withinTotal,
} from "@/lib/grade/document-parts";

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

describe("parseGithubRepoUrl", () => {
  it.each([
    "https://github.com/fellow/cli-app",
    "https://github.com/fellow/cli-app/",
    "https://github.com/fellow/cli-app.git",
    "https://www.github.com/fellow/cli-app",
    "https://github.com/fellow/cli-app/tree/development",
    "  https://github.com/fellow/cli-app  ",
  ])("reads %s as the repository", (url) => {
    expect(parseGithubRepoUrl(url)).toEqual({ owner: "fellow", repo: "cli-app" });
  });

  it.each([
    // A link to one file names a file, not a submission.
    "https://github.com/fellow/cli-app/blob/main/menu.py",
    // An account's page names no repository.
    "https://github.com/fellow",
    "https://docs.google.com/document/d/abc123/edit",
    "https://gitlab.com/fellow/cli-app",
    "github.com/fellow/cli-app",
    "not a link",
  ])("refuses %s", (url) => {
    expect(parseGithubRepoUrl(url)).toBeNull();
  });
});

describe("selectRepoFiles", () => {
  const file = (path: string, size = 100) => ({ path, size });

  it("keeps the fellow's files", () => {
    const { kept, refused } = selectRepoFiles(
      [file("main.py"), file("menu.py"), file("tests/test_quiz.py"), file("REFLECTIONS.md")],
      200_000,
    );
    expect(kept).toEqual(["main.py", "menu.py", "tests/test_quiz.py", "REFLECTIONS.md"]);
    expect(refused).toEqual([]);
  });

  // A committed virtual environment is thousands of files nobody in the class wrote. Listing each
  // as a refusal would bury the refusals that matter.
  it("skips a committed virtual environment and caches without a refusal", () => {
    const { kept, refused } = selectRepoFiles(
      [
        file("main.py"),
        file(".venv/lib/python3.12/site-packages/pytest/__init__.py"),
        file("__pycache__/menu.cpython-312.pyc"),
        file(".pytest_cache/README.md"),
      ],
      200_000,
    );
    expect(kept).toEqual(["main.py"]);
    expect(refused).toEqual([]);
  });

  // A screenshot sits beside the code it illustrates. Counted against the byte allowance, three of
  // them would leave no room for main.py.
  it("refuses images by name before they count against the limits", () => {
    const { kept, refused } = selectRepoFiles(
      [
        file("assets/a.png", 150_000),
        file("assets/b.png", 150_000),
        file("assets/c.jpg", 150_000),
        file("main.py"),
      ],
      MAX_REPO_BYTES,
    );
    expect(kept).toEqual(["main.py"]);
    expect(refused.map((item) => item.label)).toEqual([
      "assets/a.png",
      "assets/b.png",
      "assets/c.jpg",
    ]);
  });

  it("refuses a file over the size limit by name", () => {
    const { kept, refused } = selectRepoFiles(
      [file("main.py"), file("data.csv", 300_000)],
      200_000,
    );
    expect(kept).toEqual(["main.py"]);
    expect(refused).toEqual([{ label: "data.csv", reason: "293 KB is more than one file may be" }]);
  });

  it("stops at the file limit and says how many files were left out", () => {
    const files = Array.from({ length: MAX_REPO_FILES + 3 }, (_, i) => file(`f${i}.py`));
    const { kept, refused } = selectRepoFiles(files, 200_000);
    expect(kept).toHaveLength(MAX_REPO_FILES);
    expect(refused).toEqual([expect.objectContaining({ label: "3 more files" })]);
  });

  it("stops at the byte limit", () => {
    const half = MAX_REPO_BYTES / 2;
    const { kept, refused } = selectRepoFiles(
      [file("a.py", half), file("b.py", half), file("c.py", 1)],
      MAX_REPO_BYTES,
    );
    expect(kept).toEqual(["a.py", "b.py"]);
    expect(refused).toEqual([expect.objectContaining({ label: "1 more file" })]);
  });
});

describe("isGithubUrl", () => {
  it("recognizes a link to a page inside a repository", () => {
    expect(isGithubUrl("https://github.com/fellow/cli-app/pull/3")).toBe(true);
  });

  it("does not claim other hosts", () => {
    expect(isGithubUrl("https://docs.google.com/document/d/abc123/edit")).toBe(false);
    expect(isGithubUrl("not a link")).toBe(false);
  });
});
