import { parseVideoUrl, videoEmbedUrl, videoWatchUrl } from "@/lib/resources/spec";

/**
 * The closed video vocabulary.
 *
 * The sharpest edge in the application: the alternative design accepts the embed HTML an
 * instructor pastes, which puts an arbitrary iframe on a page every student in the cohort opens.
 * So the id is taken out of a recognised URL shape and the frame is built from the id — and what
 * has to hold is the *refusals*, because every string in the "must come back null" list below is
 * one a substring match would have accepted.
 */
describe("parseVideoUrl", () => {
  describe("the shapes YouTube actually uses", () => {
    it.each([
      ["a watch link out of the address bar", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
      ["without the www", "https://youtube.com/watch?v=dQw4w9WgXcQ"],
      ["the mobile host", "https://m.youtube.com/watch?v=dQw4w9WgXcQ"],
      ["the no-cookie host", "https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ"],
      ["a share link", "https://youtu.be/dQw4w9WgXcQ"],
      ["an embed address", "https://www.youtube.com/embed/dQw4w9WgXcQ"],
      ["a short", "https://www.youtube.com/shorts/dQw4w9WgXcQ"],
      ["a live address", "https://www.youtube.com/live/dQw4w9WgXcQ"],
      ["with extra query parameters", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"],
      ["with surrounding whitespace", "  https://youtu.be/dQw4w9WgXcQ  "],
    ])("reads %s", (_label, url) => {
      expect(parseVideoUrl(url)).toEqual({ provider: "YOUTUBE", videoId: "dQw4w9WgXcQ" });
    });
  });

  describe("the shapes Vimeo actually uses", () => {
    it.each([
      ["a plain link", "https://vimeo.com/123456789"],
      ["a channel link", "https://vimeo.com/channels/staffpicks/123456789"],
      ["the player address", "https://player.vimeo.com/video/123456789"],
    ])("reads %s", (_label, url) => {
      expect(parseVideoUrl(url)).toEqual({ provider: "VIMEO", videoId: "123456789" });
    });

    it("takes the numeric id of an unlisted link rather than its hash", () => {
      // `/123456789/abcdef` is an unlisted video: the number identifies it, the hash grants
      // access. Taking the first segment would work here and fail on a channel link.
      expect(parseVideoUrl("https://vimeo.com/123456789/abcdef")).toEqual({
        provider: "VIMEO",
        videoId: "123456789",
      });
    });
  });

  describe("what must come back null", () => {
    it.each([
      // Every one of these contains "youtube.com" or "vimeo.com" as a substring.
      ["a host merely containing youtube.com", "https://evil.example/youtube.com/watch?v=abc"],
      ["a subdomain trick", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"],
      ["a lookalike host", "https://youtubee.com/watch?v=dQw4w9WgXcQ"],
      ["a path that mentions vimeo", "https://evil.example/vimeo.com/123456789"],
      // Not http(s), and both parse perfectly well as URLs.
      ["a javascript: URL", "javascript:alert(1)"],
      ["a data: URL", "data:text/html;base64,PHNjcmlwdD4="],
      // Recognised host, but not a video.
      ["a channel rather than a video", "https://www.youtube.com/@someteacher"],
      ["a YouTube URL with no id", "https://www.youtube.com/watch"],
      ["an id of the wrong length", "https://www.youtube.com/watch?v=tooshort"],
      ["a traversal in place of an id", "https://www.youtube.com/embed/../../etc/passwd"],
      ["a non-numeric Vimeo path", "https://vimeo.com/channels/staffpicks"],
      // Another service entirely.
      ["a different video service", "https://www.loom.com/share/abc123"],
      // Not a URL at all.
      ["a bare string", "dQw4w9WgXcQ"],
      ["nothing", ""],
    ])("refuses %s", (_label, url) => {
      expect(parseVideoUrl(url)).toBeNull();
    });
  });
});

describe("the addresses are rebuilt from the stored id", () => {
  it("builds the frame from the id, never from what was pasted", () => {
    // The difference between a closed vocabulary and a promise about one.
    expect(videoEmbedUrl({ provider: "YOUTUBE", videoId: "dQw4w9WgXcQ" })).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(videoEmbedUrl({ provider: "VIMEO", videoId: "123456789" })).toBe(
      "https://player.vimeo.com/video/123456789",
    );
  });

  it("builds the watch link the same way", () => {
    // So this application cannot print a link to something its own embed refused.
    expect(videoWatchUrl({ provider: "YOUTUBE", videoId: "dQw4w9WgXcQ" })).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(videoWatchUrl({ provider: "VIMEO", videoId: "123456789" })).toBe(
      "https://vimeo.com/123456789",
    );
  });

  it("collapses the twenty ways of writing one YouTube link into one", () => {
    const written = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    ];
    const rebuilt = new Set(written.map((url) => videoWatchUrl(parseVideoUrl(url)!)));
    expect(rebuilt.size).toBe(1);
  });
});
