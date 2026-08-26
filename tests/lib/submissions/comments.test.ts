import {
  awaitsReply,
  commentAuthorRole,
  commentExcerpt,
  isUnread,
  MAX_COMMENT_LENGTH,
  threadSubmissionId,
  type ThreadComment,
  unreadCount,
  visibleBody,
} from "@/lib/submissions/comments";

/*
  The pure rules behind the conversation on a piece of work. Every one of these is a sentence that
  three screens have to agree about, so the point of the file is that the sentence is written once
  and checked here rather than re-derived at each call site.
*/

const FELLOW = "fellow-1";
const TEAMMATE = "fellow-2";
const INSTRUCTOR = "instructor-1";

const T = {
  first: new Date("2026-08-01T10:00:00Z"),
  second: new Date("2026-08-02T10:00:00Z"),
  third: new Date("2026-08-03T10:00:00Z"),
};

/** A message, with the shape the rules read and nothing else. */
function comment(over: Partial<ThreadComment> = {}): ThreadComment {
  return {
    authorId: FELLOW,
    authorRole: "STUDENT",
    createdAt: T.first,
    deletedAt: null,
    ...over,
  };
}

describe("commentAuthorRole", () => {
  it("records a fellow as the fellow's side", () => {
    expect(commentAuthorRole("STUDENT")).toBe("STUDENT");
  });

  it("folds an admin into the staff side", () => {
    // An admin replying to a fellow is replying as staff. A third value would be a distinction
    // no reader of the column asks about.
    expect(commentAuthorRole("INSTRUCTOR")).toBe("INSTRUCTOR");
    expect(commentAuthorRole("ADMIN")).toBe("INSTRUCTOR");
  });
});

describe("threadSubmissionId", () => {
  it("is the row itself for work somebody holds in their own right", () => {
    expect(threadSubmissionId({ id: "own", teamSubmissionId: null })).toBe("own");
  });

  it("resolves a mirror to the row holding the team's work", () => {
    // The whole of "a team shares one conversation". A comment written against the mirror would
    // found a thread the rest of the team cannot see, which the database trigger refuses.
    expect(threadSubmissionId({ id: "mirror", teamSubmissionId: "held" })).toBe("held");
  });
});

describe("isUnread", () => {
  it("is unread for a reader who has never opened the thread", () => {
    expect(isUnread(comment({ authorId: INSTRUCTOR }), { id: FELLOW, lastReadAt: null })).toBe(true);
  });

  it("is unread when it arrived after the reader's last visit", () => {
    // Compared against the receipt rather than checked for null, which is what makes one column
    // enough for a conversation somebody comes back to.
    const reader = { id: FELLOW, lastReadAt: T.first };
    expect(isUnread(comment({ authorId: INSTRUCTOR, createdAt: T.second }), reader)).toBe(true);
  });

  it("is read when it arrived before the reader's last visit", () => {
    const reader = { id: FELLOW, lastReadAt: T.second };
    expect(isUnread(comment({ authorId: INSTRUCTOR, createdAt: T.first }), reader)).toBe(false);
  });

  it("is read when it landed in the same instant the receipt was written", () => {
    // The boundary is deliberate: `markRead` writes the clock after the thread has been sent, so
    // only something strictly later is genuinely unseen.
    const reader = { id: FELLOW, lastReadAt: T.second };
    expect(isUnread(comment({ authorId: INSTRUCTOR, createdAt: T.second }), reader)).toBe(false);
  });

  it("is never news to the person who wrote it", () => {
    // Otherwise a fellow posting a question would immediately be told there was something new,
    // which is the state they just left.
    const reader = { id: FELLOW, lastReadAt: null };
    expect(isUnread(comment({ authorId: FELLOW }), reader)).toBe(false);
  });

  it("is news to a teammate who did not write it", () => {
    const reader = { id: TEAMMATE, lastReadAt: null };
    expect(isUnread(comment({ authorId: FELLOW }), reader)).toBe(true);
  });

  it("is never news once it has been withdrawn", () => {
    // A badge on a thread whose only new row is a tombstone sends somebody to read nothing.
    const reader = { id: FELLOW, lastReadAt: null };
    expect(isUnread(comment({ authorId: INSTRUCTOR, deletedAt: T.third }), reader)).toBe(false);
  });

  it("is news when its author's account has gone", () => {
    // `authorId` is SetNull, so a departed instructor's answer keeps standing. It cannot be
    // mistaken for the reader's own writing.
    const reader = { id: FELLOW, lastReadAt: null };
    expect(isUnread(comment({ authorId: null }), reader)).toBe(true);
  });
});

describe("unreadCount", () => {
  const thread = [
    comment({ authorId: FELLOW, createdAt: T.first }),
    comment({ authorId: INSTRUCTOR, authorRole: "INSTRUCTOR", createdAt: T.second }),
    comment({ authorId: INSTRUCTOR, authorRole: "INSTRUCTOR", createdAt: T.third }),
  ];

  it("counts every standing message somebody else wrote for a first-time reader", () => {
    expect(unreadCount(thread, { id: FELLOW, lastReadAt: null })).toBe(2);
  });

  it("counts differently for two members of one team, from one thread", () => {
    // The receipt is per reader, which is the whole reason it is a table rather than a column on
    // the submission. A teammate who has read nothing sees all three.
    expect(unreadCount(thread, { id: TEAMMATE, lastReadAt: null })).toBe(3);
  });

  it("is zero once the reader has been through it", () => {
    expect(unreadCount(thread, { id: FELLOW, lastReadAt: T.third })).toBe(0);
  });

  it("is zero for an empty thread", () => {
    expect(unreadCount([], { id: FELLOW, lastReadAt: null })).toBe(0);
  });
});

describe("awaitsReply", () => {
  const question = comment({ authorId: FELLOW, authorRole: "STUDENT" });
  const answer = comment({ authorId: INSTRUCTOR, authorRole: "INSTRUCTOR" });

  it("is false for a thread nobody has written in", () => {
    expect(awaitsReply([])).toBe(false);
  });

  it("waits when a fellow spoke last", () => {
    expect(awaitsReply([{ ...question, createdAt: T.first }])).toBe(true);
  });

  it("stops waiting once an instructor has replied", () => {
    expect(
      awaitsReply([
        { ...question, createdAt: T.first },
        { ...answer, createdAt: T.second },
      ]),
    ).toBe(false);
  });

  it("treats one reply as answering several questions", () => {
    // Answered by being replied to, not message by message. Three questions and one reply that
    // covers them is answered.
    expect(
      awaitsReply([
        { ...question, createdAt: T.first },
        { ...question, createdAt: T.second },
        { ...answer, createdAt: T.third },
      ]),
    ).toBe(false);
  });

  it("stops waiting once an instructor settles it without replying", () => {
    // For a question handled in person, or one the fellow worked out. Nothing was written, so
    // the newest message is still theirs.
    expect(awaitsReply([{ ...question, createdAt: T.first }], T.second)).toBe(false);
  });

  it("waits again when a fellow asks after it was settled", () => {
    // Compared against the question rather than checked for null, which is what stops a thread
    // being settled once and never appearing again.
    expect(awaitsReply([{ ...question, createdAt: T.third }], T.second)).toBe(true);
  });

  it("counts a question settled in the same instant as settled", () => {
    expect(awaitsReply([{ ...question, createdAt: T.second }], T.second)).toBe(false);
  });

  it("ignores a settling that predates nothing, because nobody is waiting anyway", () => {
    expect(awaitsReply([{ ...answer, createdAt: T.third }], T.first)).toBe(false);
  });

  it("waits again when a fellow follows up after a reply", () => {
    expect(
      awaitsReply([
        { ...question, createdAt: T.first },
        { ...answer, createdAt: T.second },
        { ...question, createdAt: T.third },
      ]),
    ).toBe(true);
  });

  it("does not wait on a question the fellow withdrew", () => {
    // Otherwise withdrawing would leave a thread on somebody's list forever, with nothing on it
    // to answer.
    expect(
      awaitsReply([
        { ...answer, createdAt: T.first },
        { ...question, createdAt: T.second, deletedAt: T.third },
      ]),
    ).toBe(false);
  });

  it("waits on the newest question standing behind a withdrawn reply", () => {
    expect(
      awaitsReply([
        { ...question, createdAt: T.first },
        { ...answer, createdAt: T.second, deletedAt: T.third },
      ]),
    ).toBe(true);
  });
});

describe("visibleBody", () => {
  it("is the text of a message that stands", () => {
    expect(visibleBody({ body: "Why did this lose two points?", deletedAt: null })).toBe(
      "Why did this lose two points?",
    );
  });

  it("is nothing once withdrawn, though the column still holds it", () => {
    // Collapsed on the server so the text never travels to another reader's browser, while an
    // instructor asking what was said can still find out.
    expect(visibleBody({ body: "never mind", deletedAt: T.third })).toBeNull();
  });
});

describe("commentExcerpt", () => {
  it("passes a short question through unchanged", () => {
    expect(commentExcerpt("Should the API live in its own file?")).toBe(
      "Should the API live in its own file?",
    );
  });

  it("flattens the markdown a triage row cannot render", () => {
    expect(commentExcerpt("## Stuck\n\n- the **JOIN** returns `null`")).toBe(
      "Stuck the JOIN returns null",
    );
  });

  it("keeps a link's text and drops its target", () => {
    expect(commentExcerpt("see [the docs](https://example.com/a/b) for this")).toBe(
      "see the docs for this",
    );
  });

  it("replaces a fenced code block rather than quoting it", () => {
    expect(commentExcerpt("this fails:\n```js\nconst x = 1;\n```\nwhy?")).toBe(
      "this fails: (code) why?",
    );
  });

  it("cuts a long body at a word boundary and marks the cut", () => {
    const excerpt = commentExcerpt(`${"word ".repeat(60)}end`, 40);
    expect(excerpt.length).toBeLessThanOrEqual(41);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toMatch(/wor…$/);
  });

  it("never exceeds the length it was given by more than the ellipsis", () => {
    const excerpt = commentExcerpt("a".repeat(300), 50);
    expect(excerpt.length).toBe(51);
  });
});

describe("MAX_COMMENT_LENGTH", () => {
  it("matches the number written as a CHECK in the migration", () => {
    // Two places on purpose: the application enforces it, and the database enforces it against a
    // script the application never sees. They have to be the same number.
    expect(MAX_COMMENT_LENGTH).toBe(5000);
  });
});
