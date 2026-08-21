import {
  DRIVE_DOC_KIND_LABEL,
  driveEmbedUrl,
  parseDriveDocUrl,
  type DriveDocKind,
} from "@/lib/drive/embed";

/**
 * The closed Drive vocabulary.
 *
 * What has to hold is the refusals, for the reason the video tests give: every string in the
 * "must come back null" list is one that a substring match, or a reader that trusted a segment's
 * position, would have accepted — and the id it produces becomes the `src` of a frame on a page
 * an instructor is signed in to.
 *
 * The other half is that the id survives every shape a student might paste. A parser that
 * recognised only the shapes we happen to think of would send an instructor to the link card for
 * a document that was sitting right there.
 */

/** A real Drive id's shape: long, mixed case, with the punctuation the alphabet allows. */
const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2u-ms";

describe("parseDriveDocUrl", () => {
  describe("the shapes students actually paste", () => {
    it.each([
      [
        "the editor, straight out of the address bar",
        `https://docs.google.com/document/d/${ID}/edit`,
      ],
      [
        "with the sharing parameter Google adds",
        `https://docs.google.com/document/d/${ID}/edit?usp=sharing`,
      ],
      ["with a fragment", `https://docs.google.com/document/d/${ID}/edit#heading=h.abc123`],
      ["a view link", `https://docs.google.com/document/d/${ID}/view`],
      ["a preview link", `https://docs.google.com/document/d/${ID}/preview`],
      [
        "the instructor's own copy prompt, pasted by mistake",
        `https://docs.google.com/document/d/${ID}/copy`,
      ],
      [
        "a template preview, pasted by mistake",
        `https://docs.google.com/document/d/${ID}/template/preview`,
      ],
      ["no trailing segment at all", `https://docs.google.com/document/d/${ID}`],
      ["a trailing slash", `https://docs.google.com/document/d/${ID}/`],
      ["surrounding whitespace", `  https://docs.google.com/document/d/${ID}/edit  `],
      ["http rather than https", `http://docs.google.com/document/d/${ID}/edit`],
      ["a shouting host", `https://DOCS.GOOGLE.COM/document/d/${ID}/edit`],
    ])("reads %s", (_label, url) => {
      expect(parseDriveDocUrl(url)).toEqual({ kind: "DOC", fileId: ID });
    });
  });

  describe("the four kinds", () => {
    it.each([
      ["a Doc", `https://docs.google.com/document/d/${ID}/edit`, "DOC"],
      ["a Sheet", `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`, "SHEET"],
      ["a Slides deck", `https://docs.google.com/presentation/d/${ID}/edit#slide=id.p`, "SLIDES"],
      [
        "a file kept in Drive",
        `https://drive.google.com/file/d/${ID}/view?usp=drive_link`,
        "DRIVE_FILE",
      ],
    ])("reads %s", (_label, url, kind) => {
      expect(parseDriveDocUrl(url)).toEqual({ kind, fileId: ID });
    });
  });

  describe("what must come back null", () => {
    it.each([
      // Each of these contains "docs.google.com" or "drive.google.com" as a substring.
      [
        "a host merely containing the name",
        `https://evil.example/docs.google.com/document/d/${ID}/edit`,
      ],
      ["a subdomain trick", `https://docs.google.com.evil.example/document/d/${ID}/edit`],
      ["a lookalike host", `https://docs-google.com/document/d/${ID}/edit`],
      // Not http(s), and both parse perfectly well as URLs.
      ["a javascript: URL", "javascript:alert(1)"],
      ["a data: URL", "data:text/html;base64,PHNjcmlwdD4="],
      // Recognised host, and not a document with a preview at the address we would build.
      ["a Form", `https://docs.google.com/forms/d/${ID}/viewform`],
      ["a Drawing", `https://docs.google.com/drawings/d/${ID}/edit`],
      ["a folder", `https://drive.google.com/drive/folders/${ID}`],
      ["the ambiguous open link", `https://drive.google.com/open?id=${ID}`],
      ["a download endpoint", `https://drive.google.com/uc?export=download&id=${ID}`],
      ["the Drive home page", "https://drive.google.com/"],
      ["a Google Site", `https://sites.google.com/view/${ID}`],
      // Recognised editor, and the id is not where a positional reader would find it.
      ["the account-scoped path", `https://docs.google.com/document/u/0/d/${ID}/edit`],
      // Not an id.
      ["an empty id", "https://docs.google.com/document/d//edit"],
      ["a traversal segment", "https://docs.google.com/document/d/..%2F..%2Fetc/edit"],
      ["an id with a dot in it", "https://docs.google.com/document/d/abcdefghij.k/edit"],
      ["an id too short to be one", "https://docs.google.com/document/d/abc123/edit"],
      // Not a URL at all: what a bare path or a filename pasted into the box looks like.
      ["a bare path", "/Users/someone/Desktop/resume.pdf"],
      ["a filename", "my-project.pdf"],
      ["nothing", ""],
    ])("refuses %s", (_label, url) => {
      expect(parseDriveDocUrl(url)).toBeNull();
    });

    /*
      Its own case, asserted on the reason rather than on the outcome.

      In a published document's address the segment after `d` is the literal `e`, and the id sits
      one place further along. A reader that trusted the position returns `fileId: "e"` and builds
      a frame address for a document that does not exist — which renders as an error page inside
      the frame, with nothing to say why. `toBeNull` alone would pass for a parser that got this
      right by luck, so the shape of the wrong answer is named.
    */
    /*
      The other side of ignoring the trailing segment, and worth asserting rather than leaving to
      be inferred: an export address names the student's document at the ordinary place, so it is
      that document and gets a frame. Only the shapes where the id is somewhere else, or means
      something else, are refused.
    */
    it("reads an export address as the document it exports", () => {
      expect(
        parseDriveDocUrl(`https://docs.google.com/document/d/${ID}/export?format=pdf`),
      ).toEqual({ kind: "DOC", fileId: ID });
    });

    it("refuses a published document rather than reading its id as `e`", () => {
      const published = `https://docs.google.com/document/d/e/2PACX-1vQx${ID}/pub`;
      expect(parseDriveDocUrl(published)).toBeNull();
      expect(parseDriveDocUrl(published)?.fileId).not.toBe("e");
    });
  });
});

describe("driveEmbedUrl", () => {
  it("builds the framable address for each kind", () => {
    expect(driveEmbedUrl({ kind: "DOC", fileId: ID })).toBe(
      `https://docs.google.com/document/d/${ID}/preview`,
    );
    expect(driveEmbedUrl({ kind: "SHEET", fileId: ID })).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/preview`,
    );
    expect(driveEmbedUrl({ kind: "DRIVE_FILE", fileId: ID })).toBe(
      `https://drive.google.com/file/d/${ID}/preview`,
    );
  });

  it("asks Slides for a player that does not start on its own", () => {
    // The exact query string, because a grading pane that began advancing through a deck the
    // moment it opened would be a moving thing beside a paragraph somebody is writing.
    expect(driveEmbedUrl({ kind: "SLIDES", fileId: ID })).toBe(
      `https://docs.google.com/presentation/d/${ID}/embed?start=false&loop=false&delayms=60000`,
    );
  });

  it("carries nothing across from what was pasted", () => {
    const ref = parseDriveDocUrl(
      `https://docs.google.com/presentation/d/${ID}/edit?usp=sharing#slide=id.g123`,
    );
    const embed = driveEmbedUrl(ref!);
    expect(embed).not.toContain("usp=");
    expect(embed).not.toContain("#");
  });

  /*
    The property that makes "what is framed is what was submitted" a fact rather than a claim
    about two functions that happen to agree today.
  */
  it.each(["DOC", "SHEET", "SLIDES", "DRIVE_FILE"] as const)(
    "builds an address that parses back to the same %s",
    (kind) => {
      const ref = { kind, fileId: ID };
      expect(parseDriveDocUrl(driveEmbedUrl(ref))).toEqual(ref);
    },
  );
});

describe("DRIVE_DOC_KIND_LABEL", () => {
  it("names every kind", () => {
    const kinds: DriveDocKind[] = ["DOC", "SHEET", "SLIDES", "DRIVE_FILE"];
    for (const kind of kinds) expect(DRIVE_DOC_KIND_LABEL[kind]).toMatch(/\S/);
  });
});
