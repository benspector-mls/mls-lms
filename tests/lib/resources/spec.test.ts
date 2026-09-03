/**
 * What a valid resource is, and the columns a valid one becomes.
 *
 * `video.test.ts` covers the other pure half of `lib/resources/spec.ts`: which URLs are videos and
 * what addresses get built from them. This covers the schema and `resourceColumns`, which together
 * decide two things a stored row depends on — that a caller cannot send one kind's fields under
 * another kind's name, and that every kind writes every column so the ones it does not use hold
 * null rather than whatever the previous kind left there.
 *
 * Nothing here reaches a database. The 12 assertions are the pure ones `verify:resources` made
 * about the schema and the column mapping; the procedures that write these columns are covered by
 * `tests/integration/resources.test.ts`.
 */
import { resourceColumns, resourceSpecSchema, UnrecognisedVideoError } from "@/lib/resources/spec";

describe("what a valid resource is", () => {
  it("a link needs a URL", () => {
    expect(resourceSpecSchema.safeParse({ kind: "LINK", title: "MDN" }).success).toBe(false);
  });

  it("...and refuses something that is not one", () => {
    expect(resourceSpecSchema.safeParse({ kind: "LINK", title: "MDN", url: "mdn" }).success).toBe(
      false,
    );
  });

  it("a note needs a body", () => {
    expect(resourceSpecSchema.safeParse({ kind: "TEXT", title: "Notes", body: "  " }).success).toBe(
      false,
    );
  });

  it("every kind needs a title", () => {
    expect(
      resourceSpecSchema.safeParse({ kind: "LINK", title: "  ", url: "https://a.example" }).success,
    ).toBe(false);
  });

  it("a description is optional and defaults to null", () => {
    const parsed = resourceSpecSchema.parse({
      kind: "LINK",
      title: "MDN",
      url: "https://a.example",
    });
    expect(parsed.kind === "LINK" ? parsed.description : "wrong kind").toBeNull();
  });

  /*
    A note has no URL field at all, so sending one is a spec for a different kind. Refused rather
    than ignored: Zod's default is to strip an unknown key silently, and stripping here would let a
    form send a link's fields under a note's kind and watch it save as something else, with no
    symptom but a resource that is not what whoever made it thought.
  */
  it("a note carrying a URL is refused rather than trimmed", () => {
    expect(
      resourceSpecSchema.safeParse({
        kind: "TEXT",
        title: "Notes",
        body: "hello",
        url: "https://a.example",
      }).success,
    ).toBe(false);
  });
});

/*
  Every kind writes every column, so the ones it does not use are nulled rather than left holding
  whatever the previous kind put there. This is what makes changing a resource's kind safe: a note
  turned into a link must not keep its body, because a row carrying both is two things at once and
  the next reader to trust either column renders something nobody wrote.
*/
describe("the columns a spec becomes", () => {
  it("a link writes no body and no video", () => {
    const asLink = resourceColumns({
      kind: "LINK",
      title: "MDN",
      url: "https://a.example",
      description: null,
    });
    expect([asLink.body, asLink.videoId]).toEqual([null, null]);
  });

  it("a note writes no url and no video", () => {
    const asText = resourceColumns({ kind: "TEXT", title: "Notes", body: "hello" });
    expect([asText.url, asText.videoId]).toEqual([null, null]);
  });

  describe("a video", () => {
    const asVideo = resourceColumns({
      kind: "VIDEO",
      title: "Lecture",
      url: "https://youtu.be/dQw4w9WgXcQ",
    });

    it("stores its provider and id", () => {
      expect([asVideo.videoProvider, asVideo.videoId]).toEqual(["YOUTUBE", "dQw4w9WgXcQ"]);
    });

    /*
      Rebuilt from the id rather than echoed, so the twenty ways of writing one YouTube address
      collapse to one — and so a link this application prints cannot point somewhere its own embed
      would have refused.
    */
    it("...and a canonical watch link rather than the paste", () => {
      expect(asVideo.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    });

    it("...and no body", () => {
      expect(asVideo.body).toBeNull();
    });
  });

  /*
    The refusal reaches the column boundary rather than stopping at the form. `resourceColumns` is
    the one function both writes go through, so a URL that somehow got past the interface is still
    refused before anything is stored — and refused as its own error, because the message an
    instructor reads has to name the two services that are recognised.
  */
  it("an unrecognised video is refused at the column boundary too", () => {
    expect(() =>
      resourceColumns({ kind: "VIDEO", title: "x", url: "https://www.loom.com/share/a" }),
    ).toThrow(UnrecognisedVideoError);
  });
});
