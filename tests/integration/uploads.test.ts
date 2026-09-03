/**
 * Handing in a file: the two procedures a student's browser calls, and who may read what they store.
 *
 * Run with `npm run test:integration`, or `npm run test:integration:supabase` against the
 * development Supabase project.
 *
 * The half worth reading is the authorization. A private bucket with no policies means the
 * procedure that mints a signed URL is the *only* thing standing between one fellow's work and
 * another's, so those checks are not a formality: if they are wrong there is no second layer behind
 * them. They are exercised through the tRPC callers inside a transaction that is rolled back,
 * because a check that only holds when the procedure is called some other way is not a check on the
 * thing students use.
 *
 * **The bucket here is a `Map` and every test says so.** `npm run test:integration` runs against a
 * disposable Postgres built from the migrations, which has no Supabase Storage behind it, so the
 * double below stands in for the bucket: `signedUploadUrl` hands out an address, a test writes the
 * bytes at it the way a browser's PUT would, and `uploadedObjectInfo` reads back what is really
 * there. What that establishes is every rule this application enforces — which paths a caller may
 * record, that the stored content type has to be the one the extension means, that a replaced
 * object is removed and a graded one is kept. What it cannot establish is anything about Supabase:
 * that the bucket is private, that it refuses an oversized object, that its allow-list holds every
 * content type this build can store, and that a signed link and only a signed link opens an object.
 * Those are facts about an environment rather than about this repository, they appear only on a real
 * round trip, and they are what `npm run verify:uploads` still does.
 *
 * Carries the 39 assertions of `verify:uploads` that need the database. The script made 123 in all:
 * 64 of them are pure and now live in `tests/lib/uploads/`, where they need nothing and run on every
 * save; 19 need the real bucket and stay in the script; and the last counted the objects a
 * rolled-back transaction had left behind, which has no subject any more — the transaction that
 * wrote them is this file's, and its bucket is a map that goes away with the run.
 *
 * **The script skipped every one of these on a freshly seeded database.** It looked for a course
 * that already had an instructor, a module and somebody on the roster, and a skip reports as
 * "nothing failed" — so the checks on who may read another fellow's work quietly stopped running and
 * nothing said so. Everything here is built by `makeWorld`, so every check always runs.
 *
 * Two checks are also stronger than the script could make them. The path it could not record was any
 * other submission row the database happened to hold; here it is a second fellow's hand-in on this
 * same assignment, which is the theft the rule exists to refuse. And the fellow refused a link to
 * somebody else's file is enrolled on this same program, so the refusal is demonstrably about not
 * owning the submission rather than about not being on the roster at all.
 */
import { HandInMethod } from "@/lib/generated/prisma/enums";
import { db } from "@/lib/prisma";
import { MAX_INLINE_TEXT_BYTES, MAX_UPLOAD_BYTES } from "@/lib/uploads/file-types";
import { assertCanHandIn, discardReplacedUpload } from "@/lib/uploads/submit";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeWorld, type World } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

/** One stored object: the bytes, and the type they were stored under. */
type StoredObject = { bytes: Buffer; contentType: string };

/**
 * The bucket, as a map held for the length of this file.
 *
 * Declared through `jest.mock` so that every module reaching storage reaches this one — the two
 * halves of an upload in `lib/uploads/submit.ts` and the two read procedures in
 * `trpc/routers/submissions.ts` — rather than each being handed its own double.
 *
 * `submissionUploadPath` and everything else pure is the real thing, which is the point of spreading
 * the actual module: what is replaced is the four calls that would otherwise cross the network, and
 * each behaves the way Supabase does, including refusing to sign a link for an object that is not
 * there.
 */
jest.mock("../../lib/uploads/storage", () => {
  const actual = jest.requireActual<typeof import("@/lib/uploads/storage")>(
    "../../lib/uploads/storage",
  );
  const objects = new Map<string, StoredObject>();

  return {
    ...actual,
    /** Reached from the tests as `bucket`, which is the only thing it is used as. */
    __objects: objects,
    signedUploadUrl: async ({ path }: { path: string }) => ({ url: `memory://upload/${path}` }),
    uploadedObjectInfo: async (path: string) => {
      const held = objects.get(path);
      return held ? { sizeBytes: held.bytes.byteLength, contentType: held.contentType } : null;
    },
    signedDownloadUrl: async ({ path }: { path: string }) => {
      if (!objects.has(path)) {
        throw new actual.UploadStorageError(`Could not sign a download link for ${path}`);
      }
      return `memory://download/${path}?token=signed-for-${encodeURIComponent(path)}`;
    },
    readSubmissionUpload: async (path: string) => {
      const held = objects.get(path);
      if (!held) throw new actual.UploadStorageError(`Could not read ${path}`);
      return held.bytes;
    },
    submissionUploadExists: async (path: string) => objects.has(path),
    removeSubmissionUpload: async (path: string) => {
      objects.delete(path);
    },
  };
});

/** The map the double holds, which every "is it in the bucket" question below is asked of. */
const bucket = (
  jest.requireMock("../../lib/uploads/storage") as { __objects: Map<string, StoredObject> }
).__objects;

/**
 * What a student's browser does between the two procedures: PUT the bytes at the address it was
 * given, with the content type the server decided.
 *
 * The content type is a parameter rather than always the right one, because two checks below are
 * about what happens when the browser sends a type the file's extension does not mean.
 */
const sendToBucket = (path: string, contentType: string, bytes: Buffer) => {
  bucket.set(path, { bytes, contentType });
};

const factory = createCallerFactory(appRouter);
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/** What a call refused with, as a string to compare against. */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

/**
 * The titles this run gives its three assignments, for the last group to look for afterwards.
 *
 * A unique suffix because the development Supabase project is shared, and a fixed title could
 * collide with an assignment somebody actually wrote.
 */
const suffix = crypto.randomUUID().slice(0, 8);
const resumeTitle = `Integration Resume ${suffix}`;
const linkTitle = `Integration Personal Site ${suffix}`;
const pythonTitle = `Integration Converter ${suffix}`;

/** The bytes every PDF hand-in below stores. Short, because nothing here measures throughput. */
const body = Buffer.from("%PDF-1.4 integration round trip\n");

describe("handing in a file", () => {
  const tx = withRollback();

  let world: World;
  /** The fellow who hands the work in. */
  let studentId: string;
  /** A second fellow on the same roster, for the refusals that need somebody who is not the owner. */
  let otherStudentId: string;

  let assignment: { id: string; pointValue: number };
  /** The assignment as `assertCanHandIn` describes it, which is what the upload half is given. */
  let handIn: Awaited<ReturnType<typeof assertCanHandIn>>;
  /** The object the first hand-in stored, which several groups below ask the bucket about. */
  let firstPath: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asStudent = () => createCaller(tx(), studentId);
  const asOtherStudent = () => createCaller(tx(), otherStudentId);

  /**
   * The three steps handing in a file actually takes, run in order.
   *
   * A student's browser asks `beginUpload` where to put the file, sends it there, and tells
   * `recordUpload` it arrived. Driving the two procedures without the upload between them would
   * test a sequence nobody performs — and the checks below turn on what is really in the bucket,
   * which only the middle step puts there.
   */
  const handInFile = async (filename: string, bytes: Buffer) => {
    const destination = await asStudent().submissions.beginUpload({
      assignmentId: assignment.id,
      filename,
      sizeBytes: bytes.byteLength,
    });
    sendToBucket(destination.path, destination.contentType, bytes);

    return asStudent().submissions.recordUpload({
      assignmentId: assignment.id,
      path: destination.path,
      filename,
    });
  };

  /** Where the submission's file is now, read from the row rather than remembered from the call. */
  const storedPathOf = async (submissionId: string) =>
    (
      await tx().submission.findUniqueOrThrow({
        where: { id: submissionId },
        select: { uploadPath: true },
      })
    ).uploadPath;

  /** The submission the fellow's first hand-in made, and what the procedure said about it. */
  let submission: Awaited<ReturnType<typeof handInFile>>;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    studentId = world.students[0]!.studentId;
    otherStudentId = world.students[1]!.studentId;
  });

  describe("authoring one, and what it will not take", () => {
    beforeAll(async () => {
      const created = await asInstructor().assignments.create({
        courseId: world.courseId,
        draft: {
          kind: "SELF_DIRECTED",
          handInMethods: ["FILE"],
          title: resumeTitle,
          courseUnitId: world.unitId,
          dueAt: null,
          acceptedFileTypes: ["pdf"],
          submissionInstructions: "One PDF, named after you.",
          sections: [{ grading: "manual", label: "Resume", pointValue: 20 }],
        },
      });
      assignment = created.assignment;
    });

    it("an assignment handed in as a file can be authored", () => {
      expect(assignment.pointValue).toBe(20);
    });

    /*
      Before publishing, an unpublished assignment is not something a student can hand in to — and
      NOT_FOUND rather than FORBIDDEN, because whether a draft exists is not theirs to learn.
    */
    it("an unpublished assignment cannot be handed in to", async () => {
      const code = await refusal(() =>
        assertCanHandIn(tx(), {
          profileId: studentId,
          assignmentId: assignment.id,
          expect: HandInMethod.FILE,
        }),
      );
      expect(code).toBe("NOT_FOUND");
    });

    describe("once it is published", () => {
      beforeAll(async () => {
        await asInstructor().assignments.publish({ assignmentId: assignment.id });
        handIn = await assertCanHandIn(tx(), {
          profileId: studentId,
          assignmentId: assignment.id,
          expect: HandInMethod.FILE,
        });
      });

      it("a published assignment can be handed in to", () => {
        expect(handIn.acceptedFileTypes).toEqual(["pdf"]);
      });

      /*
        The upload IS the submission for this kind, so the procedure that submits a link must refuse
        it. Without this refusal a student could mark work handed in with nothing behind it, and two
        things would be authorities on the same columns.
      */
      it("submitWork refuses an assignment handed in only as a file", async () => {
        const code = await refusal(() =>
          asStudent().submissions.submitWork({
            assignmentId: assignment.id,
            submittedUrl: "https://example.com/not-a-file",
          }),
        );
        expect(code).toBe("BAD_REQUEST");
      });

      // The wrong kind of file is refused before an address to send it to even exists, which is
      // earlier than it used to be refused: nothing can reach the bucket at all.
      it("a type the assignment does not accept is refused", async () => {
        const code = await refusal(() =>
          asStudent().submissions.beginUpload({
            assignmentId: assignment.id,
            filename: "screenshot.png",
            sizeBytes: 1024,
          }),
        );
        expect(code).toBe("BAD_REQUEST");
      });

      // And so is one over the limit, on what the browser says, before a byte is sent.
      it("a file over the limit is refused before it is uploaded", async () => {
        const code = await refusal(() =>
          asStudent().submissions.beginUpload({
            assignmentId: assignment.id,
            filename: "enormous.pdf",
            sizeBytes: MAX_UPLOAD_BYTES + 1,
          }),
        );
        expect(code).toBe("BAD_REQUEST");
      });
    });
  });

  describe("the hand-in itself", () => {
    beforeAll(async () => {
      submission = await handInFile("Ben Spector resume.pdf", body);
      firstPath = (await storedPathOf(submission.id))!;
    });

    it("uploading is what enters the queue", () => {
      expect([submission.status, submission.isLate, submission.submittedAt !== null]).toEqual([
        "SUBMITTED",
        false,
        true,
      ]);
    });

    it("the filename the student chose is kept", async () => {
      const row = await tx().submission.findUniqueOrThrow({
        where: { id: submission.id },
        select: { uploadFilename: true },
      });
      expect(row.uploadFilename).toBe("Ben Spector resume.pdf");
    });

    it("and the size with it", async () => {
      const row = await tx().submission.findUniqueOrThrow({
        where: { id: submission.id },
        select: { uploadSizeBytes: true },
      });
      expect(row.uploadSizeBytes).toBe(body.byteLength);
    });

    // The path is built from the submission id, which is what makes a stored file traceable back to
    // the row describing it with no lookup table and no trust placed in a filename.
    it("the stored path is keyed by the submission", () => {
      expect(firstPath.startsWith(`${submission.id}/`)).toBe(true);
    });

    // The row saying there is a file and there being a file are different claims, and the second is
    // the one an instructor cares about when a download fails.
    it("the file is really in the bucket", () => {
      expect(bucket.has(firstPath)).toBe(true);
    });
  });

  /*
    ---- What the browser is not trusted about ---------------------------------

    The bytes travel from the student's machine to the bucket without passing through this
    application, so everything the second call says about them is a claim. These are the four ways
    that claim could be false, and each has to be refused — there is nothing behind these checks,
    because the only other thing that saw the file was the browser.

    The signed address itself refuses two of them outright: it names one path and covers it with a
    signature, so a token cannot be aimed anywhere else, and it writes once. What is left is what a
    caller could still *say* to `recordUpload`, which is what these are.
  */
  describe("what the browser is not trusted about", () => {
    /** The second fellow's own hand-in on this assignment, which is the folder nobody else may name. */
    let otherSubmissionId: string;
    let unusedPath: string;

    beforeAll(async () => {
      const theirs = await asOtherStudent().submissions.beginUpload({
        assignmentId: assignment.id,
        filename: "Their resume.pdf",
        sizeBytes: body.byteLength,
      });
      sendToBucket(theirs.path, theirs.contentType, body);
      const theirSubmission = await asOtherStudent().submissions.recordUpload({
        assignmentId: assignment.id,
        path: theirs.path,
        filename: "Their resume.pdf",
      });
      otherSubmissionId = theirSubmission.id;

      // An address that was minted and never used. This is the state a dropped connection leaves.
      unusedPath = (
        await asStudent().submissions.beginUpload({
          assignmentId: assignment.id,
          filename: "never sent.pdf",
          sizeBytes: body.byteLength,
        })
      ).path;
    });

    it("a path in somebody else's folder cannot be recorded", async () => {
      const code = await refusal(() =>
        asStudent().submissions.recordUpload({
          assignmentId: assignment.id,
          path: `${otherSubmissionId}/stolen.pdf`,
          filename: "stolen.pdf",
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("a file that never arrived cannot be recorded", async () => {
      const code = await refusal(() =>
        asStudent().submissions.recordUpload({
          assignmentId: assignment.id,
          path: unusedPath,
          filename: "never sent.pdf",
        }),
      );
      expect(code).toBe("NOT_FOUND");
    });

    /*
      The browser sets the content type header on its own upload, so it could send one the bucket
      allows for some other kind of file. The bucket refuses a type on no list at all; this refuses a
      type that is on the list but is not what this file's extension means — which is what keeps
      `contentTypeFor` the only thing that ever decides how a stored file is handed back.
    */
    it("a file stored under a type its extension does not mean is refused", async () => {
      const mislabelled = await asStudent().submissions.beginUpload({
        assignmentId: assignment.id,
        filename: "mislabelled.pdf",
        sizeBytes: body.byteLength,
      });
      sendToBucket(mislabelled.path, "image/png", body);

      const code = await refusal(() =>
        asStudent().submissions.recordUpload({
          assignmentId: assignment.id,
          path: mislabelled.path,
          filename: "mislabelled.pdf",
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    // And the filename cannot describe the object as a kind of file it is not, which is what an
    // instructor's download would otherwise be named after.
    it("a filename that disagrees with what was stored is refused", async () => {
      const renamed = await asStudent().submissions.beginUpload({
        assignmentId: assignment.id,
        filename: "renamed.pdf",
        sizeBytes: body.byteLength,
      });
      sendToBucket(renamed.path, "application/pdf", body);

      const code = await refusal(() =>
        asStudent().submissions.recordUpload({
          assignmentId: assignment.id,
          path: renamed.path,
          filename: "renamed.png",
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    // None of the four changed the submission, which is the point of refusing them.
    it("and none of those refusals moved the work", async () => {
      expect(await storedPathOf(submission.id)).toBe(firstPath);
    });
  });

  // --- the triage bucket it lands in ------------------------------------------
  describe("where the work waits", () => {
    const queueRow = async () => {
      const queued = await asInstructor().submissions.listForAssignment({
        assignmentId: assignment.id,
      });
      return queued.submissions.find((entry) => entry.id === submission.id);
    };

    it("an uploaded submission waits on a person", async () => {
      expect((await queueRow())?.bucket).toBe("needs_manual_grade");
    });

    it("the queue carries the filename so it can be offered for download", async () => {
      expect((await queueRow())?.uploadFilename).toBe("Ben Spector resume.pdf");
    });
  });

  /*
    ---- Who may read the bytes ------------------------------------------------

    This is the whole of the access control on stored files. The bucket has no policies, so if these
    checks are wrong there is nothing behind them.
  */
  describe("who may read the bytes", () => {
    it("the student who uploaded it can fetch their own", async () => {
      const link = await asStudent().submissions.uploadUrl({ submissionId: submission.id });
      expect(link.url.includes("token=")).toBe(true);
    });

    it("the instructor who teaches the course can fetch it", async () => {
      const link = await asInstructor().submissions.uploadUrl({ submissionId: submission.id });
      expect(link.url.includes("token=")).toBe(true);
    });

    /*
      A fellow on this same roster, which is what makes the refusal say what it should. Somebody
      enrolled nowhere would be refused by every clause at once, so it would pass while telling us
      nothing about owning a submission.
    */
    it("another fellow cannot", async () => {
      const code = await refusal(() =>
        asOtherStudent().submissions.uploadUrl({ submissionId: submission.id }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  /*
    ---- Work made somewhere else ----------------------------------------------

    Handed in as a link like a Drive file, and distributed like nothing at all. What is checked here
    is that the two halves land on the right side of each rule.
  */
  describe("work made somewhere else", () => {
    let linkAssignmentId: string;
    let linkSubmitted: { id: string; status: string; submittedUrl: string | null };

    beforeAll(async () => {
      const created = await asInstructor().assignments.create({
        courseId: world.courseId,
        draft: {
          kind: "SELF_DIRECTED",
          handInMethods: ["LINK"],
          title: linkTitle,
          courseUnitId: world.unitId,
          dueAt: null,
          submissionInstructions: "Make it in Canva, then share the link.",
          sections: [{ grading: "manual", label: "Total", pointValue: 15 }],
        },
      });
      linkAssignmentId = created.assignment.id;
      await asInstructor().assignments.publish({ assignmentId: linkAssignmentId });
    });

    // Nothing to hand out, so there is no Accept — the same as a file upload.
    it("a self-directed assignment cannot be accepted", async () => {
      const code = await refusal(() =>
        asStudent().assignments.accept({ assignmentId: linkAssignmentId }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    // And it is NOT the upload route's business, which is the half that would be easy to get wrong
    // once two kinds submit a link.
    it("it cannot be handed in as a file", async () => {
      const code = await refusal(() =>
        assertCanHandIn(tx(), {
          profileId: studentId,
          assignmentId: linkAssignmentId,
          expect: HandInMethod.FILE,
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    describe("submitting the link", () => {
      beforeAll(async () => {
        linkSubmitted = await asStudent().submissions.submitWork({
          assignmentId: linkAssignmentId,
          submittedUrl: "https://www.canva.com/design/DAF123/view",
        });
      });

      it("submitting the link is what enters the queue", () => {
        expect([linkSubmitted.status, linkSubmitted.submittedUrl]).toEqual([
          "SUBMITTED",
          "https://www.canva.com/design/DAF123/view",
        ]);
      });

      it("and it waits on a person, like every hand-graded kind", async () => {
        const queue = await asInstructor().submissions.listForAssignment({
          assignmentId: linkAssignmentId,
        });
        expect(queue.submissions.find((entry) => entry.id === linkSubmitted.id)?.bucket).toBe(
          "needs_manual_grade",
        );
      });

      // A submission that was handed in as a link has no bytes at all, which is a different answer
      // from being refused them.
      it("a submission with no file has no text", async () => {
        const code = await refusal(() =>
          asStudent().submissions.uploadText({ submissionId: linkSubmitted.id }),
        );
        expect(code).toBe("NOT_FOUND");
      });
    });
  });

  /*
    ---- A Python script, and who may read its text ----------------------------

    The second procedure that reaches stored bytes, so the same questions the signed URL is asked
    have to be asked of it. The bucket has no policies; if these are wrong there is nothing behind
    them.
  */
  describe("a Python script, and who may read its text", () => {
    const pySource = "def to_celsius(f):\n    return (f - 32) * 5 / 9\n";

    let pyAssignmentId: string;
    let pyHandIn: Awaited<ReturnType<typeof assertCanHandIn>>;
    let pySubmissionId: string;

    beforeAll(async () => {
      const created = await asInstructor().assignments.create({
        courseId: world.courseId,
        draft: {
          kind: "SELF_DIRECTED",
          handInMethods: ["FILE"],
          title: pythonTitle,
          courseUnitId: world.unitId,
          dueAt: null,
          acceptedFileTypes: ["python"],
          submissionInstructions: "One .py file.",
          sections: [{ grading: "manual", label: "Script", pointValue: 10 }],
        },
      });
      pyAssignmentId = created.assignment.id;
      await asInstructor().assignments.publish({ assignmentId: pyAssignmentId });

      pyHandIn = await assertCanHandIn(tx(), {
        profileId: studentId,
        assignmentId: pyAssignmentId,
        expect: HandInMethod.FILE,
      });

      const destination = await asStudent().submissions.beginUpload({
        assignmentId: pyAssignmentId,
        filename: "converter.py",
        sizeBytes: Buffer.byteLength(pySource),
      });
      sendToBucket(destination.path, destination.contentType, Buffer.from(pySource));
      const recorded = await asStudent().submissions.recordUpload({
        assignmentId: pyAssignmentId,
        path: destination.path,
        filename: "converter.py",
      });
      pySubmissionId = recorded.id;
    });

    it("an assignment can ask for Python", () => {
      expect(pyHandIn.acceptedFileTypes).toEqual(["python"]);
    });

    it("a PDF is refused where the assignment asks for Python", async () => {
      const code = await refusal(() =>
        asStudent().submissions.beginUpload({
          assignmentId: pyAssignmentId,
          filename: "resume.pdf",
          sizeBytes: 1024,
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    it("the student who uploaded it can read their own text", async () => {
      const read = await asStudent().submissions.uploadText({ submissionId: pySubmissionId });
      expect(read.text).toBe(pySource);
    });

    it("the instructor who teaches the course can read it", async () => {
      const read = await asInstructor().submissions.uploadText({ submissionId: pySubmissionId });
      expect(read.text).toBe(pySource);
    });

    it("another fellow cannot read it", async () => {
      const code = await refusal(() =>
        asOtherStudent().submissions.uploadText({ submissionId: pySubmissionId }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    /*
      The size ceiling, exercised by writing the column the guard reads rather than by uploading half
      a megabyte to prove a comparison. The guard is deliberately built on the recorded size
      precisely so it can refuse before fetching anything, and this is the same question it asks.

      Last in this group, because it leaves the row describing a file far larger than the one stored.
    */
    it("a file too long to show is refused before it is read", async () => {
      await tx().submission.update({
        where: { id: pySubmissionId },
        data: { uploadSizeBytes: MAX_INLINE_TEXT_BYTES + 1 },
      });

      const code = await refusal(() =>
        asStudent().submissions.uploadText({ submissionId: pySubmissionId }),
      );
      expect(code).toBe("PAYLOAD_TOO_LARGE");
    });
  });

  /*
    ---- Replacing the work, and what happens to what it replaced --------------

    Before a grade, a replacement is a correction: nothing describes the old file, so it goes. The
    graded case is the opposite and is the group after this one.

    Placed after every group that reads the submission, because both of these rewrite which object it
    points at and one of them removes the file altogether.
  */
  describe("replacing the work", () => {
    let secondPath: string;

    beforeAll(async () => {
      const second = await handInFile("Ben Spector resume v2.pdf", body);
      secondPath = (await storedPathOf(second.id))!;
    });

    it("a second upload is stored beside the first rather than over it", () => {
      expect(secondPath).not.toBe(firstPath);
    });

    it("and the object the first one left behind is gone", () => {
      expect(bucket.has(firstPath)).toBe(false);
    });

    it("while the one now standing is there", () => {
      expect(bucket.has(secondPath)).toBe(true);
    });

    /*
      Handing the same work in the other way. This assignment takes only a file, so the link form
      would be refused on it — the check that matters here is what happens to the stored object when
      the columns that named it are cleared, which is the same act either way.
    */
    it("clearing the columns takes the object with it", async () => {
      await tx().submission.update({
        where: { id: submission.id },
        data: { uploadPath: null, uploadFilename: null, uploadSizeBytes: null },
      });
      await discardReplacedUpload({ uploadPath: secondPath, gradedAt: null });

      expect(bucket.has(secondPath)).toBe(false);
    });
  });

  /*
    ---- And what a released grade protects ------------------------------------

    The other half of the rule, and the one worth having a check for: feedback is written about a
    file, so once a grade exists the file it describes has to survive the next hand-in. Otherwise a
    fellow disputing a score and the instructor defending it are arguing about a document neither can
    open.

    `gradedAt` is written directly here rather than by driving an approval, because what is under
    test is the removal rule and not the grading pipeline — and the rule reads exactly this one
    column.
  */
  describe("what a released grade protects", () => {
    /** The file the grade is written about. */
    let gradedPath: string;
    /** The file handed in after it. */
    let revisedPath: string;
    let revisedGradedAt: Date | null;

    beforeAll(async () => {
      const restored = await handInFile("Ben Spector resume.pdf", body);
      gradedPath = (await storedPathOf(restored.id))!;

      await tx().submission.update({
        where: { id: restored.id },
        data: { gradedAt: new Date("2026-02-01T12:00:00Z"), status: "GRADED" },
      });

      const revised = await handInFile("Ben Spector resume, revised.pdf", body);
      const row = await tx().submission.findUniqueOrThrow({
        where: { id: revised.id },
        select: { uploadPath: true, gradedAt: true },
      });
      revisedPath = row.uploadPath!;
      revisedGradedAt = row.gradedAt;
    });

    it("a resubmission keeps the file the grade was written about", () => {
      expect(bucket.has(gradedPath)).toBe(true);
    });

    it("and the revised file is the one the submission now points at", () => {
      expect(revisedPath).not.toBe(gradedPath);
      expect(bucket.has(revisedPath)).toBe(true);
    });

    it("a graded submission is what the rule reads, not its status", () => {
      expect(revisedGradedAt).not.toBeNull();
    });
  });
});

/*
  The transaction rolled back, and this is the check that says so. It reads the committed database,
  outside any transaction, after the group above has ended — which is what makes it safe to point
  this suite at a database somebody is using.
*/
describe("the rollback really rolled back", () => {
  it("none of the assignments this run created survived", async () => {
    const left = await db.assignment.count({
      where: { title: { in: [resumeTitle, linkTitle, pythonTitle] } },
    });
    expect(left).toBe(0);
  });
});
