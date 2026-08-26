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
import { createChecker, loadEnvironment, refusal } from "./verify/harness";
import { HandInMethod } from "../lib/generated/prisma/enums";

loadEnvironment();

const { check, skip, finish } = createChecker();

async function main() {
  const {
    acceptAttributeFor,
    checkUpload,
    describeAcceptedTypes,
    extensionOf,
    formatBytes,
    isUploadFileTypeKey,
    MAX_INLINE_TEXT_BYTES,
    MAX_UPLOAD_BYTES,
    mimeTypesFor,
    previewKindOf,
    safeDownloadName,
    contentTypeFor,
    extensionsOf,
    UPLOAD_FILE_TYPE_KEYS,
  } = await import("../lib/uploads/file-types");

  // --- what may be handed in ------------------------------------------------
  const pdfOnly = ["pdf"];

  check(
    "a PDF is accepted where PDFs are asked for",
    checkUpload({ filename: "resume.pdf", sizeBytes: 1024, acceptedTypes: pdfOnly }),
    { ok: true, type: "pdf", extension: ".pdf", contentType: "application/pdf" },
  );
  check(
    "case does not matter",
    checkUpload({ filename: "RESUME.PDF", sizeBytes: 1024, acceptedTypes: pdfOnly }).ok,
    true,
  );
  check(
    "a type the assignment did not ask for is refused",
    checkUpload({ filename: "screenshot.png", sizeBytes: 1024, acceptedTypes: pdfOnly }).ok,
    false,
  );
  check(
    "...and it is refused for the right reason",
    checkUpload({ filename: "screenshot.png", sizeBytes: 1024, acceptedTypes: pdfOnly }),
    { ok: false, reason: "This assignment accepts .pdf, and that is a .png file." },
  );
  check(
    "the same file is accepted where images are asked for",
    checkUpload({ filename: "screenshot.png", sizeBytes: 1024, acceptedTypes: ["image"] }),
    { ok: true, type: "image", extension: ".png", contentType: "image/png" },
  );

  /*
    The last dot decides. Matching on "contains .pdf" would accept resume.pdf.exe, which is an
    executable with a reassuring name — the oldest trick there is.
  */
  check(
    "the last extension is the one that counts",
    checkUpload({ filename: "resume.pdf.exe", sizeBytes: 1024, acceptedTypes: pdfOnly }).ok,
    false,
  );
  check(
    "a file with no extension is refused rather than guessed at",
    checkUpload({ filename: "resume", sizeBytes: 1024, acceptedTypes: pdfOnly }).ok,
    false,
  );

  check(
    "an oversized file is refused",
    checkUpload({ filename: "big.pdf", sizeBytes: MAX_UPLOAD_BYTES + 1, acceptedTypes: pdfOnly })
      .ok,
    false,
  );
  check(
    "a file exactly at the limit is accepted",
    checkUpload({ filename: "big.pdf", sizeBytes: MAX_UPLOAD_BYTES, acceptedTypes: pdfOnly }).ok,
    true,
  );
  check(
    "an empty file is refused",
    checkUpload({ filename: "empty.pdf", sizeBytes: 0, acceptedTypes: pdfOnly }).ok,
    false,
  );

  // An assignment that accepts nothing cannot be authored — the spec refuses it — so this is
  // about a row that predates the column rather than about a form an instructor filled in.
  check(
    "an assignment accepting nothing refuses everything",
    checkUpload({ filename: "resume.pdf", sizeBytes: 1024, acceptedTypes: [] }).ok,
    false,
  );
  check(
    "an unknown type key is ignored rather than trusted",
    checkUpload({ filename: "deck.key", sizeBytes: 1024, acceptedTypes: ["keynote"] }).ok,
    false,
  );

  check("extensionOf lowercases", extensionOf("Report.PDF"), ".pdf");
  check("extensionOf has no answer for a bare name", extensionOf("Makefile"), null);
  check("a dotfile has no extension either", extensionOf(".gitignore"), ".gitignore");

  // --- what the interface is told -------------------------------------------
  check(
    "the accept attribute lists extensions, which is what browsers match on",
    acceptAttributeFor(["pdf", "image"]),
    ".pdf,.png,.jpg,.jpeg,.gif,.webp",
  );
  check(
    "duplicate extensions across types appear once",
    acceptAttributeFor(["pdf", "pdf"]),
    ".pdf",
  );
  check("an unknown key contributes nothing", acceptAttributeFor(["keynote"]), "");
  check("one type reads as itself", describeAcceptedTypes(["pdf"]), "PDF");
  check("two types read as a choice", describeAcceptedTypes(["pdf", "image"]), "PDF or Images");
  check(
    "three read as a list",
    describeAcceptedTypes(["pdf", "image", "document"]),
    "PDF, Images or Word and plain text",
  );
  check("every key is known to itself", UPLOAD_FILE_TYPE_KEYS.every(isUploadFileTypeKey), true);
  check(
    "the bucket's allow-list covers every type an assignment can ask for",
    mimeTypesFor(UPLOAD_FILE_TYPE_KEYS).includes("application/pdf"),
    true,
  );

  /*
    --- the extension decides the content type, and it has to ------------------

    The bucket carries its own allow-list built from these same entries by `setup:storage`, so
    the only types ever stored have to be the ones on it. Storing what the browser reported
    instead is the failure this pair guards: a `.docx` arrives as `application/octet-stream` on
    a machine without Word, and a `.ipynb` almost never arrives as anything Jupyter would
    recognise — accepted by the route, refused by the bucket, on one student's machine and no
    other.
  */
  check(
    "every extension has a content type",
    UPLOAD_FILE_TYPE_KEYS.flatMap(extensionsOf).every((ext) => contentTypeFor(ext) !== null),
    true,
  );
  check(
    "...and every one of them is on the bucket's allow-list",
    UPLOAD_FILE_TYPE_KEYS.flatMap(extensionsOf).every((ext) =>
      mimeTypesFor(UPLOAD_FILE_TYPE_KEYS).includes(contentTypeFor(ext)!),
    ),
    true,
  );
  /*
    An extension may belong to one type and no more, which `contentTypeFor` depends on rather
    than merely prefers: it returns the first key whose extensions contain the one it was given,
    so a second claim on the same extension is a stored content type decided by the order the
    table happens to be written in. Nothing in the types catches that, so this does.
  */
  check(
    "no extension belongs to two types",
    (() => {
      const seen = new Map<string, string>();
      const doubled: string[] = [];
      for (const key of UPLOAD_FILE_TYPE_KEYS) {
        for (const extension of extensionsOf(key)) {
          const held = seen.get(extension);
          if (held) doubled.push(`${extension} is in both ${held} and ${key}`);
          else seen.set(extension, key);
        }
      }
      return doubled;
    })(),
    [],
  );
  check(
    "a notebook is stored as a notebook, whatever the browser said",
    contentTypeFor(".ipynb"),
    "application/x-ipynb+json",
  );
  check(
    "a spreadsheet is stored as one too",
    contentTypeFor(".xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  check("case does not matter", contentTypeFor(".PDF"), "application/pdf");
  check("an extension nothing accepts has none", contentTypeFor(".exe"), null);
  check(
    "the check hands back the type the file will be stored under",
    (() => {
      const result = checkUpload({
        filename: "analysis.ipynb",
        sizeBytes: 1024,
        acceptedTypes: ["notebook"],
      });
      return result.ok ? result.contentType : result.reason;
    })(),
    "application/x-ipynb+json",
  );

  // --- the two types added for notebooks and spreadsheets --------------------
  check(
    "a notebook is accepted where the assignment asks for one",
    checkUpload({ filename: "mod-3.ipynb", sizeBytes: 2048, acceptedTypes: ["notebook"] }).ok,
    true,
  );
  check(
    "...and refused where it does not",
    checkUpload({ filename: "mod-3.ipynb", sizeBytes: 2048, acceptedTypes: ["pdf"] }).ok,
    false,
  );
  check("a spreadsheet covers the three shapes one arrives in", extensionsOf("spreadsheet"), [
    ".xlsx",
    ".xls",
    ".csv",
  ]);
  check(
    "a CSV is a spreadsheet rather than plain text, because that is what asks for it",
    checkUpload({ filename: "data.csv", sizeBytes: 512, acceptedTypes: ["document"] }).ok,
    false,
  );

  // --- Python, the type that is read on the screen rather than downloaded ---
  check(
    "a Python file is accepted where the assignment asks for one",
    checkUpload({ filename: "main.py", sizeBytes: 512, acceptedTypes: ["python"] }),
    { ok: true, type: "python", extension: ".py", contentType: "text/x-python" },
  );
  check(
    "...and refused where it does not",
    checkUpload({ filename: "main.py", sizeBytes: 512, acceptedTypes: ["pdf"] }).ok,
    false,
  );
  /*
    The reason the key holds `.py` alone. An assignment asking for a Python script accepts Python
    scripts, by the same rule that ticking PDF does not also accept Word — so a `code` key holding
    every language would have been the wrong shape, however many fewer tick boxes it draws.
  */
  check(
    "ticking Python does not also accept JavaScript",
    checkUpload({ filename: "app.js", sizeBytes: 512, acceptedTypes: ["python"] }).ok,
    false,
  );
  check("a Python file is stored as Python", contentTypeFor(".py"), "text/x-python");
  check("...whatever case it was named in", contentTypeFor(".PY"), "text/x-python");
  check("the file input asks for .py and nothing else", acceptAttributeFor(["python"]), ".py");
  check("and the student is told the word", describeAcceptedTypes(["python"]), "Python");

  check("bytes are formatted for a person", formatBytes(MAX_UPLOAD_BYTES), "25.0 MB");
  check("...and small files are not reported as 0.0 MB", formatBytes(2048), "2 KB");

  // --- the filename, which is the student's and not to be trusted -----------
  check("a filename keeps its spaces", safeDownloadName("My Resume v2.pdf"), "My Resume v2.pdf");
  check("path separators come out", safeDownloadName("../../etc/passwd"), "..-..-etc-passwd");
  check("quotes and newlines come out", safeDownloadName('re"su\nme.pdf'), "resume.pdf");
  check("a name that is nothing but junk still has a name", safeDownloadName('"""'), "submission");

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
  check("nor a spreadsheet", previewKindOf("data.xlsx"), null);
  /*
    Nor a notebook, which is the one that costs something. It is the most-read of these and the
    download-and-open-elsewhere loop that embedding a PDF exists to remove is exactly what a
    grader is left with. Rendering one is a real dependency and its own decision — this check is
    here to say the answer is deliberate rather than an oversight.
  */
  check(
    "nor a notebook, though that is the one worth rendering one day",
    previewKindOf("analysis.ipynb"),
    null,
  );
  /*
    Code is shown by the other of the two routes: read as text through `submissions.uploadText`
    and coloured here, rather than handed to a browser that has no viewer for it.
  */
  check("a Python file is shown as code", previewKindOf("main.py"), "code");
  check("...whatever case it was named in", previewKindOf("MAIN.PY"), "code");
  /*
    Plain text and Markdown are not, and that is a decision rather than an omission: the same
    machinery would serve them, and Markdown in particular wants rendering rather than colouring,
    so widening this is something to do on purpose. Checked so that widening it by accident —
    which is what returning "code" for everything `languageForPath` knows would be — fails here.
  */
  check("plain text is not, which keeps this to one type", previewKindOf("notes.txt"), null);
  check("nor Markdown", previewKindOf("README.md"), null);
  check("nor a file with no extension", previewKindOf("resume"), null);

  // --- the path bytes go to -------------------------------------------------
  const { submissionUploadPath, SUBMISSION_UPLOAD_BUCKET, storageClient } =
    await import("../lib/uploads/storage");

  const path = submissionUploadPath({
    submissionId: "11111111-2222-3333-4444-555555555555",
    extension: ".pdf",
  });
  check(
    "the path starts with the submission it belongs to",
    path.startsWith("11111111-2222-3333-4444-555555555555/"),
    true,
  );
  check("...and ends in the checked extension", path.endsWith(".pdf"), true);
  // The student's filename is never in the path. It is theirs, it can contain anything, and a
  // path is not where to find that out.
  check(
    "the student's filename is nowhere in it",
    submissionUploadPath({ submissionId: "abc", extension: ".pdf" }).includes("resume"),
    false,
  );
  check(
    "two uploads for one submission do not collide",
    submissionUploadPath({ submissionId: "abc", extension: ".pdf" }) ===
      submissionUploadPath({ submissionId: "abc", extension: ".pdf" }),
    false,
  );

  // --- the bucket itself ----------------------------------------------------
  const { data: bucket } = await storageClient().getBucket(SUBMISSION_UPLOAD_BUCKET);

  if (!bucket) {
    console.log(
      `\nskip everything below — the "${SUBMISSION_UPLOAD_BUCKET}" bucket does not exist. ` +
        `Run npm run setup:storage.`,
    );
    return finish();
  }

  // The whole of the security question. A public bucket would publish every submission in it to
  // anyone holding a URL, and a URL is not a secret.
  check("the bucket is private", bucket.public, false);
  check(
    "the bucket enforces the size limit itself, not only our code",
    Number(bucket.file_size_limit),
    MAX_UPLOAD_BYTES,
  );

  // --- a real round trip ----------------------------------------------------
  const {
    signedDownloadUrl,
    storeSubmissionUpload,
    submissionUploadExists,
    removeSubmissionUpload,
  } = await import("../lib/uploads/storage");

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
    check(
      "...and the bytes are the same ones",
      Buffer.from(await fetched.arrayBuffer()).equals(body),
      true,
    );

    /*
      The point of a private bucket. The public URL for the same object must not work, or every
      signed link would be theatre over something already readable by anyone with the path.
    */
    const publicUrl = storageClient().from(SUBMISSION_UPLOAD_BUCKET).getPublicUrl(stored.path)
      .data.publicUrl;
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
    check(
      "...as its own content type",
      inlineResponse.headers.get("content-type"),
      "application/pdf",
    );
    check(
      "...with no attachment disposition, so a browser displays it",
      inlineResponse.headers.get("content-disposition"),
      null,
    );
    check(
      "...and is not frame-blocked, which is what lets it be embedded",
      [
        inlineResponse.headers.get("x-frame-options"),
        inlineResponse.headers.get("content-security-policy"),
      ],
      [null, null],
    );

    // The download link is the opposite, and the filename it saves as is the student's own.
    check(
      "a download link still asks the browser to save it",
      (await fetch(url)).headers.get("content-disposition")?.startsWith("attachment"),
      true,
    );
  } finally {
    await removeSubmissionUpload(stored.path);
  }

  check("the object is gone once removed", await submissionUploadExists(stored.path), false);

  /*
    --- the bucket's allow-list, against the newest type -----------------------

    The one failure the pure checks above cannot see. Every extension having a content type is a
    fact about this repository; the bucket accepting that content type is a fact about *this
    environment*, and the two come apart the moment a file type is added and `setup:storage` is
    not re-run somewhere. It appears only on a real upload, so this is a real upload.

    A notebook because it is the newest and the least likely to have been on any allow-list by
    accident — `application/pdf` would pass this on a bucket configured years ago.
  */
  const notebookBytes = Buffer.from('{"cells": [], "nbformat": 4}\n');
  const notebookType = contentTypeFor(".ipynb")!;
  let notebookStored: { path: string } | null = null;
  try {
    notebookStored = await storeSubmissionUpload({
      submissionId: `verify-${Date.now()}`,
      extension: ".ipynb",
      contentType: notebookType,
      bytes: notebookBytes,
    });
    check("the bucket accepts every type this build can store", true, true);
  } catch (err) {
    check(
      "the bucket accepts every type this build can store",
      `${notebookType} refused — run npm run setup:storage against this environment ` +
        `(${err instanceof Error ? err.message : String(err)})`,
      true,
    );
  }
  if (notebookStored) {
    check(
      "...and hands it back as itself",
      (
        await fetch(
          await signedDownloadUrl({
            path: notebookStored.path,
            filename: "analysis.ipynb",
            disposition: "inline",
          }),
        )
      ).headers.get("content-type"),
      notebookType,
    );
    await removeSubmissionUpload(notebookStored.path);
  }

  /*
    And the same for Python, which is newer still. This is the check that fails in an environment
    where `npm run setup:storage` has not been re-run since the type was added — the route would
    accept a `.py` file and the bucket would refuse to store it, on a real student's hand-in and
    nowhere else.
  */
  const pythonType = contentTypeFor(".py")!;
  let pythonStored: { path: string } | null = null;
  try {
    pythonStored = await storeSubmissionUpload({
      submissionId: `verify-${Date.now()}`,
      extension: ".py",
      contentType: pythonType,
      bytes: Buffer.from("def main():\n    print('hello')\n"),
    });
    check("the bucket accepts Python too", true, true);
  } catch (err) {
    check(
      "the bucket accepts Python too",
      `${pythonType} refused — run npm run setup:storage against this environment ` +
        `(${err instanceof Error ? err.message : String(err)})`,
      true,
    );
  }
  if (pythonStored) {
    check(
      "...and hands it back as itself",
      (
        await fetch(
          await signedDownloadUrl({
            path: pythonStored.path,
            filename: "main.py",
            disposition: "inline",
          }),
        )
      ).headers.get("content-type"),
      pythonType,
    );
    await removeSubmissionUpload(pythonStored.path);
  }

  // --- who may hand in, and who may read ------------------------------------
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { assertCanHandIn, discardReplacedUpload, storeAndRecordUpload } =
    await import("../lib/uploads/submit");

  /*
    A course that satisfies all four requirements at once, rather than the first active one.

    Asking for the first active course and then asking whether it happens to have an instructor, a
    module and a bound student is how this whole group came to be skipped on a database that has
    exactly what it needs: the first course in the list is a prework shell with nobody enrolled,
    and one course further down has all three. A skip reports as "nothing failed", so the checks
    below — which are the only test of who may read another student's work — quietly stopped
    running and nothing said so.
  */
  const course = await db.course.findFirst({
    where: {
      archivedAt: null,
      instructors: { some: {} },
      courseUnits: { some: {} },
      // Somebody on the program's roster, which is where enrollment lives now.
      program: { enrollments: { some: {} } },
    },
    select: { id: true, programId: true },
  });
  const instructor = course
    ? await db.courseInstructor.findFirst({
        where: { courseId: course.id },
        select: { userId: true },
      })
    : null;
  /*
    Any status, deliberately. Handing work in needs an *active* student and this lifecycle does hand
    work in, so the enrollment is restored inside the transaction below rather than required to be
    active here. Requiring it meant that removing a student in the running application silently
    stopped this whole group of checks, while the script went on reporting a pass.
  */
  const enrollment = course
    ? await db.enrollment.findFirst({
        where: { programId: course.programId },
        orderBy: { createdAt: "asc" },
        select: { id: true, studentId: true, status: true },
      })
    : null;
  const studentId = enrollment?.studentId ?? null;
  // A module row rather than a tag off the course. An assignment belongs to a module and the
  // foreign key says so, so a course with none cannot hold one — which is a skip, not a failure.
  const firstModule = course
    ? await db.courseUnit.findFirst({
        where: { courseId: course.id },
        orderBy: { position: "asc" },
        select: { id: true },
      })
    : null;
  const courseUnitId = firstModule?.id;

  if (!course || !instructor || !studentId || !courseUnitId) {
    skip("the lifecycle — no seeded course with an instructor, a bound student, and a module");
    return finish();
  }

  const createCaller = createCallerFactory(appRouter);
  /** Objects written inside the rolled-back transaction, which the rollback cannot remove. */
  const strays: string[] = [];

  try {
    /*
      A timeout of its own, following the other `verify:*` scripts. Prisma allows an interactive
      transaction five seconds by default, and this one stores two real objects in the bucket and
      reads them back — network round trips to Supabase, not queries — so the default is not a
      budget that means anything here. When it is exceeded every check after the first slow call
      fails with a transaction error, which reads as a broken procedure rather than a slow one.
    */
    await db.$transaction(
      async (tx) => {
        const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
        const asStudent = createCaller({ db: tx, user: { id: studentId } } as never);

        // Inside the transaction, so it is undone with everything else. Handing work in needs an
        // active student, and the seeded one may have been removed in the running application.
        if (enrollment!.status !== "ACTIVE") {
          await asInstructor.enrollments.restore({ enrollmentId: enrollment!.id });
        }

        const { assignment } = await asInstructor.assignments.create({
          courseId: course.id,
          draft: {
            kind: "SELF_DIRECTED",
            handInMethods: ["FILE"],
            title: "Resume, first draft (verify:uploads)",
            courseUnitId,
            dueAt: null,
            acceptedFileTypes: ["pdf"],
            submissionInstructions: "One PDF, named after you.",
            sections: [{ grading: "manual", label: "Resume", pointValue: 20 }],
          },
        });
        check("an assignment handed in as a file can be authored", assignment.pointValue, 20);

        // Before publishing, an unpublished assignment is not something a student can hand in to
        // — and NOT_FOUND rather than FORBIDDEN, because whether a draft exists is not theirs
        // to learn.
        check(
          "an unpublished assignment cannot be handed in to",
          await refusal(() =>
            assertCanHandIn(tx as never, {
              profileId: studentId,
              assignmentId: assignment.id,
              expect: HandInMethod.FILE,
            }),
          ),
          "NOT_FOUND",
        );

        await asInstructor.assignments.publish({ assignmentId: assignment.id });

        /*
        The upload IS the submission for this kind, so the procedure that submits a link must
        refuse it. Without this refusal a student could mark work handed in with nothing behind
        it, and two things would be authorities on the same columns.
      */
        check(
          "submitWork refuses an assignment handed in only as a file",
          await refusal(() =>
            asStudent.submissions.submitWork({
              assignmentId: assignment.id,
              submittedUrl: "https://example.com/not-a-file",
            }),
          ),
          "BAD_REQUEST",
        );

        const handIn = await assertCanHandIn(tx as never, {
          profileId: studentId,
          assignmentId: assignment.id,
          expect: HandInMethod.FILE,
        });
        check("a published assignment can be handed in to", handIn.acceptedFileTypes, ["pdf"]);

        // The wrong kind of file is refused before anything is stored.
        check(
          "a type the assignment does not accept is refused",
          await refusal(() =>
            storeAndRecordUpload(tx as never, {
              profileId: studentId,
              assignment: handIn,
              filename: "screenshot.png",
              bytes: Buffer.from("not a pdf"),
            }),
          ),
          "BAD_REQUEST",
        );

        const submission = await storeAndRecordUpload(tx as never, {
          profileId: studentId,
          assignment: handIn,
          filename: "Ben Spector resume.pdf",
          bytes: body,
        });

        check(
          "uploading is what enters the queue",
          [submission.status, submission.isLate, submission.submittedAt !== null],
          ["SUBMITTED", false, true],
        );
        check(
          "the filename the student chose is kept",
          submission.uploadFilename,
          "Ben Spector resume.pdf",
        );
        check("and the size with it", submission.uploadSizeBytes, body.byteLength);

        const row = await tx.submission.findUniqueOrThrow({
          where: { id: submission.id },
          select: { uploadPath: true },
        });
        if (row.uploadPath) strays.push(row.uploadPath);
        check(
          "the stored path is keyed by the submission",
          row.uploadPath?.startsWith(`${submission.id}/`),
          true,
        );
        check(
          "the file is really in the bucket",
          await submissionUploadExists(row.uploadPath!),
          true,
        );

        // --- replacing the work, and what happens to what it replaced ---------
        //
        // Whether the object is really gone is a fact about *this environment's* bucket rather
        // than about this repository — the same reason a real notebook and a real .py file are
        // stored further down rather than asserted about.
        //
        // Before a grade, a replacement is a correction: nothing describes the old file, so it
        // goes. The graded case is the opposite and is checked further down.
        const secondUpload = await storeAndRecordUpload(tx as never, {
          profileId: studentId,
          assignment: handIn,
          filename: "Ben Spector resume v2.pdf",
          bytes: body,
        });

        const afterSecond = await tx.submission.findUniqueOrThrow({
          where: { id: secondUpload.id },
          select: { uploadPath: true, gradedAt: true },
        });
        if (afterSecond.uploadPath) strays.push(afterSecond.uploadPath);

        check(
          "a second upload is stored beside the first rather than over it",
          afterSecond.uploadPath !== row.uploadPath,
          true,
        );
        check(
          "and the object the first one left behind is gone",
          await submissionUploadExists(row.uploadPath!),
          false,
        );
        check(
          "while the one now standing is there",
          await submissionUploadExists(afterSecond.uploadPath!),
          true,
        );

        /*
          Handing the same work in the other way. This assignment takes only a file, so the link
          form would be refused on it — the check that matters here is what happens to the stored
          object when the columns that named it are cleared, which is the same act either way.
        */
        await tx.submission.update({
          where: { id: secondUpload.id },
          data: { uploadPath: null, uploadFilename: null, uploadSizeBytes: null },
        });
        await discardReplacedUpload(afterSecond);
        check(
          "clearing the columns takes the object with it",
          await submissionUploadExists(afterSecond.uploadPath!),
          false,
        );

        // Put the file back, so every check below reads the submission the rest of this expects.
        const restored = await storeAndRecordUpload(tx as never, {
          profileId: studentId,
          assignment: handIn,
          filename: "Ben Spector resume.pdf",
          bytes: body,
        });
        const restoredRow = await tx.submission.findUniqueOrThrow({
          where: { id: restored.id },
          select: { uploadPath: true },
        });
        if (restoredRow.uploadPath) strays.push(restoredRow.uploadPath);

        /*
          --- and what a released grade protects ------------------------------

          The other half of the rule, and the one worth having a check for: feedback is written
          about a file, so once a grade exists the file it describes has to survive the next
          hand-in. Otherwise a fellow disputing a score and the instructor defending it are
          arguing about a document neither can open.

          `gradedAt` is written directly here rather than by driving an approval, because what is
          under test is the removal rule and not the grading pipeline — and the rule reads exactly
          this one column.
        */
        await tx.submission.update({
          where: { id: restored.id },
          data: { gradedAt: new Date(), status: "GRADED" },
        });

        const afterGrade = await storeAndRecordUpload(tx as never, {
          profileId: studentId,
          assignment: handIn,
          filename: "Ben Spector resume, revised.pdf",
          bytes: body,
        });
        const revisedRow = await tx.submission.findUniqueOrThrow({
          where: { id: afterGrade.id },
          select: { uploadPath: true, gradedAt: true },
        });
        if (revisedRow.uploadPath) strays.push(revisedRow.uploadPath);

        check(
          "a resubmission keeps the file the grade was written about",
          await submissionUploadExists(restoredRow.uploadPath!),
          true,
        );
        check(
          "and the revised file is the one the submission now points at",
          revisedRow.uploadPath !== restoredRow.uploadPath &&
            (await submissionUploadExists(revisedRow.uploadPath!)),
          true,
        );
        check(
          "a graded submission is what the rule reads, not its status",
          revisedRow.gradedAt !== null,
          true,
        );

        // Back to ungraded and pointing at one file, named as it was, which is what every check
        // below expects.
        await tx.submission.update({
          where: { id: restored.id },
          data: {
            gradedAt: null,
            status: "SUBMITTED",
            uploadPath: restoredRow.uploadPath,
            uploadFilename: "Ben Spector resume.pdf",
          },
        });
        await discardReplacedUpload({ uploadPath: revisedRow.uploadPath, gradedAt: null });

        // --- the triage bucket it lands in ------------------------------------
        const queued = await asInstructor.submissions.listForAssignment({
          assignmentId: assignment.id,
        });
        const queueRow = queued.submissions.find((entry) => entry.id === submission.id);
        check("an uploaded submission waits on a person", queueRow?.bucket, "needs_manual_grade");
        check(
          "the queue carries the filename so it can be offered for download",
          queueRow?.uploadFilename,
          "Ben Spector resume.pdf",
        );

        // --- who may read the bytes ------------------------------------------
        //
        // This is the whole of the access control on stored files. The bucket has no policies, so
        // if these checks are wrong there is nothing behind them.
        const ownLink = await asStudent.submissions.uploadUrl({ submissionId: submission.id });
        check(
          "the student who uploaded it can fetch their own",
          ownLink.url.includes("token="),
          true,
        );

        const instructorLink = await asInstructor.submissions.uploadUrl({
          submissionId: submission.id,
        });
        check(
          "the instructor who teaches the course can fetch it",
          instructorLink.url.includes("token="),
          true,
        );

        const otherStudent = await tx.profile.findFirst({
          where: { id: { notIn: [studentId, instructor.userId] }, role: "STUDENT" },
          select: { id: true },
        });

        if (otherStudent) {
          const asOther = createCaller({ db: tx, user: { id: otherStudent.id } } as never);
          check(
            "another student cannot",
            await refusal(() => asOther.submissions.uploadUrl({ submissionId: submission.id })),
            "FORBIDDEN",
          );
        } else {
          console.log("skip  another student cannot — only one student profile is seeded");
        }

        // --- work made somewhere else ---------------------------------------
        //
        // Handed in as a link like a Drive file, and distributed like nothing at all. What is
        // checked here is that the two halves land on the right side of each rule.
        const { assignment: linkAssignment } = await asInstructor.assignments.create({
          courseId: course.id,
          draft: {
            kind: "SELF_DIRECTED",
            handInMethods: ["LINK"],
            title: "Personal site on Canva (verify:uploads)",
            courseUnitId,
            dueAt: null,
            submissionInstructions: "Make it in Canva, then share the link.",
            sections: [{ grading: "manual", label: "Total", pointValue: 15 }],
          },
        });
        await asInstructor.assignments.publish({ assignmentId: linkAssignment.id });

        // Nothing to hand out, so there is no Accept — the same as a file upload.
        check(
          "a self-directed assignment cannot be accepted",
          await refusal(() => asStudent.assignments.accept({ assignmentId: linkAssignment.id })),
          "PRECONDITION_FAILED",
        );

        // And it is NOT the upload route's business, which is the half that would be easy to get
        // wrong once two kinds submit a link.
        check(
          "it cannot be handed in as a file",
          await refusal(() =>
            assertCanHandIn(tx as never, {
              profileId: studentId,
              assignmentId: linkAssignment.id,
              expect: HandInMethod.FILE,
            }),
          ),
          "BAD_REQUEST",
        );

        const linkSubmitted = await asStudent.submissions.submitWork({
          assignmentId: linkAssignment.id,
          submittedUrl: "https://www.canva.com/design/DAF123/view",
        });
        check(
          "submitting the link is what enters the queue",
          [linkSubmitted.status, linkSubmitted.submittedUrl],
          ["SUBMITTED", "https://www.canva.com/design/DAF123/view"],
        );

        const linkQueue = await asInstructor.submissions.listForAssignment({
          assignmentId: linkAssignment.id,
        });
        check(
          "and it waits on a person, like every hand-graded kind",
          linkQueue.submissions.find((entry) => entry.id === linkSubmitted.id)?.bucket,
          "needs_manual_grade",
        );

        // --- a Python script, and who may read its text ----------------------
        //
        // The second procedure that reaches stored bytes, so the same four questions the signed URL
        // is asked have to be asked of it. The bucket has no policies; if these are wrong there is
        // nothing behind them.
        const { assignment: pyAssignment } = await asInstructor.assignments.create({
          courseId: course.id,
          draft: {
            kind: "SELF_DIRECTED",
            handInMethods: ["FILE"],
            title: "Temperature converter (verify:uploads)",
            courseUnitId,
            dueAt: null,
            acceptedFileTypes: ["python"],
            submissionInstructions: "One .py file.",
            sections: [{ grading: "manual", label: "Script", pointValue: 10 }],
          },
        });
        await asInstructor.assignments.publish({ assignmentId: pyAssignment.id });

        const pyHandIn = await assertCanHandIn(tx as never, {
          profileId: studentId,
          assignmentId: pyAssignment.id,
          expect: HandInMethod.FILE,
        });
        check("an assignment can ask for Python", pyHandIn.acceptedFileTypes, ["python"]);
        check(
          "a PDF is refused where the assignment asks for Python",
          await refusal(() =>
            storeAndRecordUpload(tx as never, {
              profileId: studentId,
              assignment: pyHandIn,
              filename: "resume.pdf",
              bytes: Buffer.from("%PDF-1.4"),
            }),
          ),
          "BAD_REQUEST",
        );

        const pySource = "def to_celsius(f):\n    return (f - 32) * 5 / 9\n";
        const pySubmission = await storeAndRecordUpload(tx as never, {
          profileId: studentId,
          assignment: pyHandIn,
          filename: "converter.py",
          bytes: Buffer.from(pySource),
        });
        const pyRow = await tx.submission.findUniqueOrThrow({
          where: { id: pySubmission.id },
          select: { uploadPath: true },
        });
        if (pyRow.uploadPath) strays.push(pyRow.uploadPath);

        check(
          "the student who uploaded it can read their own text",
          (await asStudent.submissions.uploadText({ submissionId: pySubmission.id })).text,
          pySource,
        );
        check(
          "the instructor who teaches the course can read it",
          (await asInstructor.submissions.uploadText({ submissionId: pySubmission.id })).text,
          pySource,
        );

        if (otherStudent) {
          const asOther = createCaller({ db: tx, user: { id: otherStudent.id } } as never);
          check(
            "another student cannot read it",
            await refusal(() => asOther.submissions.uploadText({ submissionId: pySubmission.id })),
            "FORBIDDEN",
          );
        } else {
          console.log("skip  another student cannot read it — only one student profile is seeded");
        }

        // A submission that was handed in as a link has no bytes at all, which is a different answer
        // from being refused them.
        check(
          "a submission with no file has no text",
          await refusal(() => asStudent.submissions.uploadText({ submissionId: linkSubmitted.id })),
          "NOT_FOUND",
        );

        /*
        The size ceiling, exercised by writing the column the guard reads rather than by uploading
        half a megabyte to prove a comparison. The guard is deliberately built on the recorded size
        precisely so it can refuse before fetching anything, and this is the same question it asks.
      */
        await tx.submission.update({
          where: { id: pySubmission.id },
          data: { uploadSizeBytes: MAX_INLINE_TEXT_BYTES + 1 },
        });
        check(
          "a file too long to show is refused before it is read",
          await refusal(() => asStudent.submissions.uploadText({ submissionId: pySubmission.id })),
          "PAYLOAD_TOO_LARGE",
        );

        throw new Error("ROLLBACK");
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  } finally {
    // The rollback undoes every row and none of the bytes: storage is not in the transaction.
    // Left behind, these would be objects no row points at.
    for (const stray of strays) await removeSubmissionUpload(stray);
  }

  for (const stray of strays) {
    check(
      "nothing is left in the bucket after the rollback",
      await submissionUploadExists(stray),
      false,
    );
  }

  return finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
