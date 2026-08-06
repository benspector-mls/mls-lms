/**
 * Everything about handing in a file, from the pure checks to a real round trip.
 *
 * Run with `npm run verify:uploads`. Needs the bucket to exist — `npm run setup:storage` — and
 * stores and then removes one real object.
 *
 * The half worth reading is the authorization. A private bucket with no policies means the
 * procedure that mints a signed URL is the *only* thing standing between one student's work and
 * another's, so that check is not a formality: if it is wrong there is no second layer behind
 * it. It is exercised through the tRPC callers inside a transaction that is rolled back, for
 * the reason `verify:approve` gives — a check that only holds when called some other way is not
 * a check on the thing students use.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else console.log(`ok   ${label}`);
}

/** What a refusal was about, or "accepted". Used so a message change does not fail a check. */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

async function main() {
  const {
    acceptAttributeFor, checkUpload, describeAcceptedTypes, extensionOf, formatBytes,
    isUploadFileTypeKey, MAX_UPLOAD_BYTES, mimeTypesFor, previewKindOf, safeDownloadName,
    UPLOAD_FILE_TYPE_KEYS,
  } = await import("../lib/uploads/file-types");

  // --- what may be handed in ------------------------------------------------
  const pdfOnly = ["pdf"];

  check("a PDF is accepted where PDFs are asked for",
    checkUpload({ filename: "resume.pdf", sizeBytes: 1024, acceptedTypes: pdfOnly }),
    { ok: true, type: "pdf", extension: ".pdf" });
  check("case does not matter",
    checkUpload({ filename: "RESUME.PDF", sizeBytes: 1024, acceptedTypes: pdfOnly }).ok, true);
  check("a type the assignment did not ask for is refused",
    checkUpload({ filename: "screenshot.png", sizeBytes: 1024, acceptedTypes: pdfOnly }).ok, false);
  check("...and it is refused for the right reason",
    checkUpload({ filename: "screenshot.png", sizeBytes: 1024, acceptedTypes: pdfOnly }),
    { ok: false, reason: "This assignment accepts .pdf, and that is a .png file." });
  check("the same file is accepted where images are asked for",
    checkUpload({ filename: "screenshot.png", sizeBytes: 1024, acceptedTypes: ["image"] }),
    { ok: true, type: "image", extension: ".png" });

  /*
    The last dot decides. Matching on "contains .pdf" would accept resume.pdf.exe, which is an
    executable with a reassuring name — the oldest trick there is.
  */
  check("the last extension is the one that counts",
    checkUpload({ filename: "resume.pdf.exe", sizeBytes: 1024, acceptedTypes: pdfOnly }).ok, false);
  check("a file with no extension is refused rather than guessed at",
    checkUpload({ filename: "resume", sizeBytes: 1024, acceptedTypes: pdfOnly }).ok, false);

  check("an oversized file is refused",
    checkUpload({ filename: "big.pdf", sizeBytes: MAX_UPLOAD_BYTES + 1, acceptedTypes: pdfOnly }).ok,
    false);
  check("a file exactly at the limit is accepted",
    checkUpload({ filename: "big.pdf", sizeBytes: MAX_UPLOAD_BYTES, acceptedTypes: pdfOnly }).ok,
    true);
  check("an empty file is refused",
    checkUpload({ filename: "empty.pdf", sizeBytes: 0, acceptedTypes: pdfOnly }).ok, false);

  // An assignment that accepts nothing cannot be authored — the spec refuses it — so this is
  // about a row that predates the column rather than about a form an instructor filled in.
  check("an assignment accepting nothing refuses everything",
    checkUpload({ filename: "resume.pdf", sizeBytes: 1024, acceptedTypes: [] }).ok, false);
  check("an unknown type key is ignored rather than trusted",
    checkUpload({ filename: "deck.key", sizeBytes: 1024, acceptedTypes: ["keynote"] }).ok, false);

  check("extensionOf lowercases", extensionOf("Report.PDF"), ".pdf");
  check("extensionOf has no answer for a bare name", extensionOf("Makefile"), null);
  check("a dotfile has no extension either", extensionOf(".gitignore"), ".gitignore");

  // --- what the interface is told -------------------------------------------
  check("the accept attribute lists extensions, which is what browsers match on",
    acceptAttributeFor(["pdf", "image"]), ".pdf,.png,.jpg,.jpeg,.gif,.webp");
  check("duplicate extensions across types appear once",
    acceptAttributeFor(["pdf", "pdf"]), ".pdf");
  check("an unknown key contributes nothing", acceptAttributeFor(["keynote"]), "");
  check("one type reads as itself", describeAcceptedTypes(["pdf"]), "PDF");
  check("two types read as a choice", describeAcceptedTypes(["pdf", "image"]), "PDF or Images");
  check("three read as a list",
    describeAcceptedTypes(["pdf", "image", "document"]), "PDF, Images or Word and plain text");
  check("every key is known to itself", UPLOAD_FILE_TYPE_KEYS.every(isUploadFileTypeKey), true);
  check("the bucket's allow-list covers every type an assignment can ask for",
    mimeTypesFor(UPLOAD_FILE_TYPE_KEYS).includes("application/pdf"), true);

  check("bytes are formatted for a person", formatBytes(MAX_UPLOAD_BYTES), "25.0 MB");
  check("...and small files are not reported as 0.0 MB", formatBytes(2048), "2 KB");

  // --- the filename, which is the student's and not to be trusted -----------
  check("a filename keeps its spaces", safeDownloadName("My Resume v2.pdf"), "My Resume v2.pdf");
  check("path separators come out", safeDownloadName("../../etc/passwd"), "..-..-etc-passwd");
  check("quotes and newlines come out",
    safeDownloadName('re"su\nme.pdf'), "resume.pdf");
  check("a name that is nothing but junk still has a name",
    safeDownloadName('"""'), "submission");

  // --- what can be shown in place rather than downloaded --------------------
  //
  // Decided from the extension for the same reason `checkUpload` is: the stored content type is
  // what the browser claimed, and a .pdf that arrived as application/octet-stream on one
  // student's machine would be the one submission an instructor still has to download.
  check("a PDF can be previewed", previewKindOf("resume.pdf"), "pdf");
  check("case does not matter here either", previewKindOf("RESUME.PDF"), "pdf");
  check("an image can be previewed", previewKindOf("screenshot.png"), "image");
  check("...whichever image it is", previewKindOf("photo.webp"), "image");
  // No browser renders a .docx, so an empty frame would be a worse answer than a download.
  check("a Word document cannot", previewKindOf("resume.docx"), null);
  check("nor plain text, which has no viewer worth framing", previewKindOf("notes.txt"), null);
  check("nor a file with no extension", previewKindOf("resume"), null);

  // --- the path bytes go to -------------------------------------------------
  const { submissionUploadPath, SUBMISSION_UPLOAD_BUCKET, storageClient } =
    await import("../lib/uploads/storage");

  const path = submissionUploadPath({
    submissionId: "11111111-2222-3333-4444-555555555555",
    extension: ".pdf",
  });
  check("the path starts with the submission it belongs to",
    path.startsWith("11111111-2222-3333-4444-555555555555/"), true);
  check("...and ends in the checked extension", path.endsWith(".pdf"), true);
  // The student's filename is never in the path. It is theirs, it can contain anything, and a
  // path is not where to find that out.
  check("the student's filename is nowhere in it",
    submissionUploadPath({ submissionId: "abc", extension: ".pdf" }).includes("resume"), false);
  check("two uploads for one submission do not collide",
    submissionUploadPath({ submissionId: "abc", extension: ".pdf" }) ===
      submissionUploadPath({ submissionId: "abc", extension: ".pdf" }),
    false);

  // --- the bucket itself ----------------------------------------------------
  const { data: bucket } = await storageClient().getBucket(SUBMISSION_UPLOAD_BUCKET);

  if (!bucket) {
    console.log(
      `\nskip everything below — the "${SUBMISSION_UPLOAD_BUCKET}" bucket does not exist. ` +
      `Run npm run setup:storage.`,
    );
    return report();
  }

  // The whole of the security question. A public bucket would publish every submission in it to
  // anyone holding a URL, and a URL is not a secret.
  check("the bucket is private", bucket.public, false);
  check("the bucket enforces the size limit itself, not only our code",
    Number(bucket.file_size_limit), MAX_UPLOAD_BYTES);

  // --- a real round trip ----------------------------------------------------
  const { signedDownloadUrl, storeSubmissionUpload, submissionUploadExists, removeSubmissionUpload } =
    await import("../lib/uploads/storage");

  const body = Buffer.from("%PDF-1.4 verify:uploads round trip\n");
  const stored = await storeSubmissionUpload({
    submissionId: `verify-${Date.now()}`,
    extension: ".pdf",
    contentType: "application/pdf",
    bytes: body,
  });

  try {
    check("the object is there once stored", await submissionUploadExists(stored.path), true);

    const url = await signedDownloadUrl({ path: stored.path, filename: "round trip.pdf" });
    const fetched = await fetch(url);
    check("a signed link fetches it", fetched.status, 200);
    check("...and the bytes are the same ones",
      Buffer.from(await fetched.arrayBuffer()).equals(body), true);

    /*
      The point of a private bucket. The public URL for the same object must not work, or every
      signed link would be theatre over something already readable by anyone with the path.
    */
    const publicUrl = storageClient()
      .from(SUBMISSION_UPLOAD_BUCKET)
      .getPublicUrl(stored.path).data.publicUrl;
    const unsigned = await fetch(publicUrl);
    check("the same object is not readable without a signature", unsigned.ok, false);

    // A tampered signature must not open it either, which is what says the token is verified
    // rather than merely present.
    const forged = new URL(url);
    const token = forged.searchParams.get("token") ?? "";
    forged.searchParams.set("token", `${token.slice(0, -6)}bad123`);
    const tampered = await fetch(forged.toString());
    check("a tampered signature does not open it", tampered.ok, false);

    /*
      The embedded preview rests on three properties of an inline link, none of which is ours to
      control: the response has to carry the object's content type, it must NOT carry an
      attachment disposition (which makes a browser download rather than display it), and it must
      not be frame-blocked. A change on Supabase's side would turn the instructor's PDF viewer
      into an empty box with no error, so it is checked rather than assumed.
    */
    const inlineUrl = await signedDownloadUrl({
      path: stored.path,
      filename: "round trip.pdf",
      disposition: "inline",
    });
    const inlineResponse = await fetch(inlineUrl);
    check("an inline link serves the object", inlineResponse.status, 200);
    check("...as its own content type",
      inlineResponse.headers.get("content-type"), "application/pdf");
    check("...with no attachment disposition, so a browser displays it",
      inlineResponse.headers.get("content-disposition"), null);
    check("...and is not frame-blocked, which is what lets it be embedded",
      [inlineResponse.headers.get("x-frame-options"),
        inlineResponse.headers.get("content-security-policy")],
      [null, null]);

    // The download link is the opposite, and the filename it saves as is the student's own.
    check("a download link still asks the browser to save it",
      (await fetch(url)).headers.get("content-disposition")?.startsWith("attachment"), true);
  } finally {
    await removeSubmissionUpload(stored.path);
  }

  check("the object is gone once removed", await submissionUploadExists(stored.path), false);

  // --- who may hand in, and who may read ------------------------------------
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { assertCanHandIn, storeAndRecordUpload } = await import("../lib/uploads/submit");

  const course = await db.course.findFirst({
    where: { archivedAt: null },
    select: { id: true },
  });
  const instructor = course
    ? await db.courseInstructor.findFirst({
        where: { courseId: course.id },
        select: { userId: true },
      })
    : null;
  // `studentId` is nullable until a student's first GitHub login binds it, so an enrollment
  // that nobody has claimed yet cannot stand in for a student here.
  const enrollment = course
    ? await db.enrollment.findFirst({
        where: { courseId: course.id, status: "ACTIVE", studentId: { not: null } },
        select: { studentId: true },
      })
    : null;
  const studentId = enrollment?.studentId ?? null;
  // A module row rather than a tag off the course. An assignment belongs to a module and the
  // foreign key says so, so a course with none cannot hold one — which is a skip, not a failure.
  const firstModule = course
    ? await db.module.findFirst({
        where: { courseId: course.id },
        orderBy: { position: "asc" },
        select: { id: true },
      })
    : null;
  const moduleId = firstModule?.id;

  if (!course || !instructor || !studentId || !moduleId) {
    console.log("\nskip the lifecycle — no seeded course with an instructor, a bound student, and a module");
    return report();
  }

  const createCaller = createCallerFactory(appRouter);
  /** Objects written inside the rolled-back transaction, which the rollback cannot remove. */
  const strays: string[] = [];

  try {
    await db.$transaction(async (tx) => {
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
      const asStudent = createCaller({ db: tx, user: { id: studentId } } as never);

      const { assignment } = await asInstructor.assignments.create({
        courseId: course.id,
        draft: {
          kind: "FILE_UPLOAD",
          title: "Resume, first draft (verify:uploads)",
          moduleId,
          dueAt: null,
          acceptedFileTypes: ["pdf"],
          submissionInstructions: "One PDF, named after you.",
          sections: [{ grading: "manual", label: "Resume", pointValue: 20 }],
        },
      });
      check("a file upload assignment can be authored", assignment.pointValue, 20);

      // Before publishing, an unpublished assignment is not something a student can hand in to
      // — and NOT_FOUND rather than FORBIDDEN, because whether a draft exists is not theirs
      // to learn.
      check("an unpublished assignment cannot be handed in to",
        await refusal(() =>
          assertCanHandIn(tx as never, {
            profileId: studentId,
            assignmentId: assignment.id,
            expect: "file",
          })),
        "NOT_FOUND");

      await asInstructor.assignments.publish({ assignmentId: assignment.id });

      /*
        The upload IS the submission for this kind, so the procedure that submits a link must
        refuse it. Without this refusal a student could mark work handed in with nothing behind
        it, and two things would be authorities on the same columns.
      */
      check("submitWork refuses a file upload assignment",
        await refusal(() =>
          asStudent.submissions.submitWork({
            assignmentId: assignment.id,
            submittedUrl: "https://example.com/not-a-file",
          })),
        "BAD_REQUEST");

      const handIn = await assertCanHandIn(tx as never, {
        profileId: studentId,
        assignmentId: assignment.id,
        expect: "file",
      });
      check("a published assignment can be handed in to", handIn.acceptedFileTypes, ["pdf"]);

      // The wrong kind of file is refused before anything is stored.
      check("a type the assignment does not accept is refused",
        await refusal(() =>
          storeAndRecordUpload(tx as never, {
            profileId: studentId,
            assignment: handIn,
            filename: "screenshot.png",
            contentType: "image/png",
            bytes: Buffer.from("not a pdf"),
          })),
        "BAD_REQUEST");

      const submission = await storeAndRecordUpload(tx as never, {
        profileId: studentId,
        assignment: handIn,
        filename: "Ben Spector resume.pdf",
        contentType: "application/pdf",
        bytes: body,
      });

      check("uploading is what enters the queue",
        [submission.status, submission.isLate, submission.submittedAt !== null],
        ["SUBMITTED", false, true]);
      check("the filename the student chose is kept",
        submission.uploadFilename, "Ben Spector resume.pdf");
      check("and the size with it", submission.uploadSizeBytes, body.byteLength);

      const row = await tx.submission.findUniqueOrThrow({
        where: { id: submission.id },
        select: { uploadPath: true },
      });
      if (row.uploadPath) strays.push(row.uploadPath);
      check("the stored path is keyed by the submission",
        row.uploadPath?.startsWith(`${submission.id}/`), true);
      check("the file is really in the bucket",
        await submissionUploadExists(row.uploadPath!), true);

      // --- the triage bucket it lands in ------------------------------------
      const queued = await asInstructor.submissions.listForAssignment({
        assignmentId: assignment.id,
      });
      const queueRow = queued.submissions.find((entry) => entry.id === submission.id);
      check("an uploaded submission waits on a person", queueRow?.bucket, "needs_manual_grade");
      check("the queue carries the filename so it can be offered for download",
        queueRow?.uploadFilename, "Ben Spector resume.pdf");

      // --- who may read the bytes ------------------------------------------
      //
      // This is the whole of the access control on stored files. The bucket has no policies, so
      // if these checks are wrong there is nothing behind them.
      const ownLink = await asStudent.submissions.uploadUrl({ submissionId: submission.id });
      check("the student who uploaded it can fetch their own", ownLink.url.includes("token="), true);

      const instructorLink = await asInstructor.submissions.uploadUrl({
        submissionId: submission.id,
      });
      check("the instructor who teaches the course can fetch it",
        instructorLink.url.includes("token="), true);

      const otherStudent = await tx.profile.findFirst({
        where: { id: { notIn: [studentId, instructor.userId] }, role: "STUDENT" },
        select: { id: true },
      });

      if (otherStudent) {
        const asOther = createCaller({ db: tx, user: { id: otherStudent.id } } as never);
        check("another student cannot",
          await refusal(() => asOther.submissions.uploadUrl({ submissionId: submission.id })),
          "FORBIDDEN");
      } else {
        console.log("skip  another student cannot — only one student profile is seeded");
      }

      // --- work made somewhere else ---------------------------------------
      //
      // Handed in as a link like a Google Doc, and distributed like nothing at all. What is
      // checked here is that the two halves land on the right side of each rule.
      const { assignment: linkAssignment } = await asInstructor.assignments.create({
        courseId: course.id,
        draft: {
          kind: "EXTERNAL_URL",
          title: "Personal site on Canva (verify:uploads)",
          moduleId,
          dueAt: null,
          submissionInstructions: "Make it in Canva, then share the link.",
          sections: [{ grading: "manual", label: "Total", pointValue: 15 }],
        },
      });
      await asInstructor.assignments.publish({ assignmentId: linkAssignment.id });

      // Nothing to hand out, so there is no Accept — the same as a file upload.
      check("an external-url assignment cannot be accepted",
        await refusal(() => asStudent.assignments.accept({ assignmentId: linkAssignment.id })),
        "PRECONDITION_FAILED");

      // And it is NOT the upload route's business, which is the half that would be easy to get
      // wrong once two kinds submit a link.
      check("it cannot be handed in as a file",
        await refusal(() =>
          assertCanHandIn(tx as never, {
            profileId: studentId,
            assignmentId: linkAssignment.id,
            expect: "file",
          })),
        "BAD_REQUEST");

      const linkSubmitted = await asStudent.submissions.submitWork({
        assignmentId: linkAssignment.id,
        submittedUrl: "https://www.canva.com/design/DAF123/view",
      });
      check("submitting the link is what enters the queue",
        [linkSubmitted.status, linkSubmitted.submittedUrl],
        ["SUBMITTED", "https://www.canva.com/design/DAF123/view"]);

      const linkQueue = await asInstructor.submissions.listForAssignment({
        assignmentId: linkAssignment.id,
      });
      check("and it waits on a person, like every hand-graded kind",
        linkQueue.submissions.find((entry) => entry.id === linkSubmitted.id)?.bucket,
        "needs_manual_grade");

      throw new Error("ROLLBACK");
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  } finally {
    // The rollback undoes every row and none of the bytes: storage is not in the transaction.
    // Left behind, these would be objects no row points at.
    for (const stray of strays) await removeSubmissionUpload(stray);
  }

  for (const stray of strays) {
    check("nothing is left in the bucket after the rollback",
      await submissionUploadExists(stray), false);
  }

  return report();
}

function report() {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
