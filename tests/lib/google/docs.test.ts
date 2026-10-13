import { exportPublicDoc, GoogleDocError, publicExportUrl } from "@/lib/google/docs";

/**
 * Reading a public Google file with no credential.
 *
 * The case that matters is the sign-in page: Google answers a request for an unshared file with
 * a 200 and HTML, so a reader that trusted the status would call every private file public and
 * hand the model a login form as the student's work.
 */

const doc = { kind: "DOC", fileId: "abc123" } as const;

function answer(body: string, contentType: string, url = "https://docs.google.com/x") {
  return {
    ok: true,
    url,
    headers: new Headers({ "content-type": contentType }),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

describe("publicExportUrl", () => {
  it("asks a Doc for markdown and a deck for a PDF", () => {
    expect(publicExportUrl(doc)).toBe("https://docs.google.com/document/d/abc123/export?format=md");
    expect(publicExportUrl({ kind: "SLIDES", fileId: "s1" })).toBe(
      "https://docs.google.com/presentation/d/s1/export/pdf",
    );
  });

  it("has no address for a Sheet", () => {
    expect(publicExportUrl({ kind: "SHEET", fileId: "s1" })).toBeNull();
  });
});

describe("exportPublicDoc", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("returns a Doc's markdown as text", async () => {
    global.fetch = jest.fn(async () => answer("# Title\n\nBody", "text/markdown; charset=utf-8"));
    const exported = await exportPublicDoc(doc);
    expect(exported).toMatchObject({
      kind: "text",
      text: "# Title\n\nBody",
      mediaType: "text/markdown",
    });
  });

  it("falls back to plain text when markdown is refused", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, url: "", headers: new Headers() })
      .mockResolvedValueOnce(answer("Title\n\nBody", "text/plain"));
    const exported = await exportPublicDoc(doc);
    expect(exported).toMatchObject({ kind: "text", mediaType: "text/plain" });
  });

  it("treats a sign-in page as not shared, whatever the status", async () => {
    global.fetch = jest.fn(async () => answer("<html>Sign in</html>", "text/html"));
    await expect(exportPublicDoc(doc)).rejects.toThrow(GoogleDocError);
    await expect(exportPublicDoc(doc)).rejects.toThrow("Anyone with the link");
  });

  it("treats a redirect to the account chooser as not shared", async () => {
    global.fetch = jest.fn(async () =>
      answer("", "text/markdown", "https://accounts.google.com/ServiceLogin"),
    );
    await expect(exportPublicDoc(doc)).rejects.toThrow("not shared");
  });

  it("refuses a Sheet by name without asking Google", async () => {
    global.fetch = jest.fn();
    await expect(exportPublicDoc({ kind: "SHEET", fileId: "s1" })).rejects.toThrow("Sheet");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a Drive file of a type the model cannot read", async () => {
    global.fetch = jest.fn(async () => answer("PK", "application/zip"));
    await expect(exportPublicDoc({ kind: "DRIVE_FILE", fileId: "f1" })).rejects.toThrow(
      "application/zip",
    );
  });
});
