/**
 * Whether Google will let a submitted document be framed, which is not ours to decide.
 *
 * Run with `npm run verify:drive-embed`.
 *
 * **The whole feature rests on two properties of Google's own responses, and neither is a promise
 * anybody made us.** A `/preview` address must answer without a frame-blocking header, and the
 * `/view` address a student actually pastes must not — because if those two were ever the same,
 * rebuilding the URL from the document id would be decoration rather than the thing that makes
 * the frame work. The same argument `verify:uploads` makes about Supabase: a change on their side
 * would turn the column beside the grade into an empty box with no error in it, and only a script
 * that asks Google will notice.
 *
 * **Two fixtures, made once by hand, in your own Drive.** Set both to "Anyone with the link can
 * view" and paste the addresses **straight out of the browser's address bar**, unedited — the
 * `?usp=sharing` tail included — so that what this parses is the shape a student submits rather
 * than a tidied version of it.
 *
 *     DRIVE_FIXTURE_DOC_URL=…    a Google Doc
 *     DRIVE_FIXTURE_FILE_URL=…   a PDF uploaded to Drive
 *
 * The second is not the optional one. It is the fixture whose pasted `/view` address is
 * frame-blocked and whose `/preview` sibling is not, so it is the only fixture that can fail if
 * the rebuild ever stops being necessary. Either may also be given on the command line as
 * `--doc=…` and `--file=…` for a one-off run.
 *
 * A missing fixture is a skip, which exits non-zero: a run that checked nothing is not a pass.
 */
import { createChecker, loadEnvironment } from "./verify/harness";

loadEnvironment();

const { check, checkThat, skip, finish } = createChecker();

/** `--doc=…` beats `DRIVE_FIXTURE_DOC_URL`, so one run can use a different document. */
function fixture(flag: string, variable: string): string | null {
  const arg = process.argv.find((entry) => entry.startsWith(`--${flag}=`));
  return arg ? arg.slice(flag.length + 3) : (process.env[variable] ?? null);
}

/**
 * Whether a response would let this application frame it, and why not when it would not.
 *
 * **Not the shape of the assertion `verify:uploads` makes, deliberately.** That one checks
 * `content-security-policy === null`, which is right for Supabase and wrong here: Google sends two
 * such headers on a perfectly framable `/preview` — `require-trusted-types-for 'script'` and a
 * `base-uri`/`object-src`/`script-src` policy — and neither has anything to do with framing. What
 * matters is the one directive that does, in any of them, so this scans rather than compares.
 */
function frameBlocking(response: Response): string | null {
  const xfo = response.headers.get("x-frame-options");
  if (xfo) return `x-frame-options: ${xfo}`;

  // `Headers.get` joins repeated headers with a comma, so one read covers however many were sent.
  const csp = response.headers.get("content-security-policy") ?? "";
  if (/frame-ancestors/i.test(csp)) return `frame-ancestors in content-security-policy: ${csp}`;

  return null;
}

async function main() {
  const { DRIVE_DOC_KIND_LABEL, driveEmbedUrl, parseDriveDocUrl } =
    await import("../lib/drive/embed");

  const fixtures: [string, string, string | null][] = [
    ["a Google Doc", "DOC", fixture("doc", "DRIVE_FIXTURE_DOC_URL")],
    ["a file kept in Drive", "DRIVE_FILE", fixture("file", "DRIVE_FIXTURE_FILE_URL")],
  ];

  const missing = fixtures.filter(([, , url]) => !url);
  if (missing.length > 0) {
    skip(
      `no fixture for ${missing.map(([label]) => label).join(" or ")}. Make one in your own Drive, ` +
        `set it to "Anyone with the link can view", and put its address in .env.local as ` +
        `DRIVE_FIXTURE_DOC_URL and DRIVE_FIXTURE_FILE_URL.`,
    );
    return finish();
  }

  // =====================================================================================
  // The fixtures are what they are supposed to be
  // =====================================================================================

  console.log("--- the fixtures parse -----------------------------------------------");

  /*
    Thin on purpose. The parser's cases belong in `tests/lib/drive/embed.test.ts`, where they cost
    nothing to run; these two exist so that pasting a folder into DRIVE_FIXTURE_DOC_URL fails here,
    legibly, rather than as a confusing header check further down.
  */
  for (const [label, expectedKind, url] of fixtures) {
    const ref = parseDriveDocUrl(url!);
    check(
      `${label} parses as ${DRIVE_DOC_KIND_LABEL[expectedKind as "DOC"]}`,
      ref?.kind,
      expectedKind,
    );
  }

  // =====================================================================================
  // Google will frame the address this application builds
  // =====================================================================================

  console.log("\n--- the preview address can be embedded -------------------------------");

  for (const [label, , url] of fixtures) {
    const ref = parseDriveDocUrl(url!);
    if (!ref) continue;

    const embed = driveEmbedUrl(ref);
    const response = await fetch(embed, { redirect: "manual", cache: "no-store" });

    check(`${label} answers at its preview address`, response.status, 200);
    checkThat(
      `...as a page a browser renders`,
      (response.headers.get("content-type") ?? "").startsWith("text/html"),
      response.headers.get("content-type") ?? "no content type",
    );
    checkThat(
      `...and is not frame-blocked, which is what lets it be embedded`,
      frameBlocking(response) === null,
      frameBlocking(response) ?? embed,
    );
  }

  // =====================================================================================
  // The rebuild is the feature, not the tidying
  // =====================================================================================

  console.log("\n--- the pasted address is the one that cannot be framed ---------------");

  /*
    The highest-value check here, and the only one that would catch Google making the two
    behaviours the same. `drive.google.com/file/d/<id>/view` is what a student copies out of the
    address bar, and it is frame-blocked; its `/preview` sibling is not. So this pair is the
    evidence that `driveEmbedUrl` is doing work — a version of this application that framed the
    submitted URL directly would show an empty box for every file kept in Drive.
  */
  const filePasted = fixture("file", "DRIVE_FIXTURE_FILE_URL")!;
  const fileRef = parseDriveDocUrl(filePasted);

  if (!fileRef) {
    skip("the Drive file fixture did not parse, so the pair below cannot be compared");
  } else {
    const viewUrl = `https://drive.google.com/file/d/${fileRef.fileId}/view`;
    const pasted = await fetch(viewUrl, { redirect: "manual", cache: "no-store" });
    const rebuilt = await fetch(driveEmbedUrl(fileRef), { redirect: "manual", cache: "no-store" });

    checkThat(
      "the /view address a student pastes refuses to be framed",
      frameBlocking(pasted) !== null,
      frameBlocking(pasted) ?? "nothing blocked it, so the rebuild is no longer necessary",
    );
    checkThat(
      "...and the /preview address built from its id does not",
      frameBlocking(rebuilt) === null,
      frameBlocking(rebuilt) ?? driveEmbedUrl(fileRef),
    );
  }

  // =====================================================================================
  // Slides, printed rather than asserted
  // =====================================================================================

  console.log("\n--- the Slides player -------------------------------------------------");

  /*
    Headers cannot see the difference between the two Slides shapes: `/preview` gives a scrolling
    read-only page and `/embed` gives the deck as a player with next and previous controls, and
    both answer 200 without a frame-blocking header. So the choice between them is a judgment a
    person makes by looking once, and this prints both addresses for a Doc-shaped id rather than
    pretending a check decided it.
  */
  const docRef = parseDriveDocUrl(fixture("doc", "DRIVE_FIXTURE_DOC_URL")!);
  if (docRef) {
    console.log(
      `     a deck's two shapes, for comparing by eye once:\n` +
        `       https://docs.google.com/presentation/d/<id>/preview\n` +
        `       ${driveEmbedUrl({ kind: "SLIDES", fileId: docRef.fileId })}`,
    );
    checkThat(
      "the deck address carries no autoplay",
      driveEmbedUrl({ kind: "SLIDES", fileId: docRef.fileId }).includes("start=false"),
      "a grading pane must not begin advancing through a deck on its own",
    );
  }

  return finish();
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
