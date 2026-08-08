/**
 * Readings, notes, and videos: the schema rules as pure functions, then the procedures.
 *
 * Run with `npm run verify:resources`.
 *
 * Two halves, and the first is where the sharp edge is. **A video URL this application does not
 * recognise must be refused rather than framed**, because the alternative is an arbitrary iframe
 * on a page every student in the cohort opens. That rule is a pure function, so it is checked as
 * one — including the near misses that a substring match would let through and a parsed host will
 * not.
 *
 * The second half drives the tRPC callers inside a transaction that is rolled back, because
 * authorization is half of what these procedures are: a resource id says nothing about which
 * course it belongs to until the row is read, and the whole point of a module-scoped write is
 * that one cohort's instructor cannot file a reading in another's.
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
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const {
    parseVideoUrl,
    resourceColumns,
    resourceSpecSchema,
    videoEmbedUrl,
    videoWatchUrl,
  } = await import("../lib/resources/spec");

  // =====================================================================================
  // The rules, as pure functions
  // =====================================================================================

  console.log("--- what counts as a video -------------------------------------------");

  const recognised: [string, string, string][] = [
    ["an ordinary watch link", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["one without the www", "https://youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["a share link", "https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["a share link with the tracking parameter", "https://youtu.be/dQw4w9WgXcQ?si=aBcDeF", "dQw4w9WgXcQ"],
    ["an embed link", "https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["a short", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["the mobile host", "https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ];

  for (const [label, url, id] of recognised) {
    check(`YouTube: ${label}`, parseVideoUrl(url), { provider: "YOUTUBE", videoId: id });
  }

  /*
    Extra query parameters survive, because a link copied at a timestamp is the ordinary case and
    refusing it would send an instructor back to strip it by hand.
  */
  check("YouTube: a timestamp does not stop it being recognised",
    parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"),
    { provider: "YOUTUBE", videoId: "dQw4w9WgXcQ" });

  check("Vimeo: a plain link", parseVideoUrl("https://vimeo.com/123456789"),
    { provider: "VIMEO", videoId: "123456789" });
  check("Vimeo: an unlisted link keeps the numeric id",
    parseVideoUrl("https://vimeo.com/123456789/abcdef0123"),
    { provider: "VIMEO", videoId: "123456789" });
  check("Vimeo: a channel link", parseVideoUrl("https://vimeo.com/channels/staffpicks/123456789"),
    { provider: "VIMEO", videoId: "123456789" });
  check("Vimeo: the player host", parseVideoUrl("https://player.vimeo.com/video/123456789"),
    { provider: "VIMEO", videoId: "123456789" });

  console.log("\n--- and what does not ------------------------------------------------");

  /*
    The check this whole vocabulary exists for. Every one of these is a string a substring match
    on "youtube.com" or "vimeo.com" would accept, and every one of them would put a frame
    pointing somewhere nobody checked on a page the whole cohort opens. Matching on the parsed
    host is what makes them all null.
  */
  const refused: [string, string][] = [
    ["a host that merely contains youtube.com", "https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a subdomain trick", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"],
    ["a lookalike host", "https://yóutube.com/watch?v=dQw4w9WgXcQ"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<iframe src=x>"],
    ["another video service", "https://www.loom.com/share/abc123"],
    ["a YouTube channel rather than a video", "https://www.youtube.com/@someone"],
    ["a YouTube URL with no id", "https://www.youtube.com/watch"],
    ["an id of the wrong length", "https://www.youtube.com/watch?v=tooshort"],
    ["a Vimeo URL with no numeric id", "https://vimeo.com/staffpicks"],
    ["a bare word", "not a url at all"],
    ["an empty string", ""],
  ];

  for (const [label, url] of refused) {
    check(`refused: ${label}`, parseVideoUrl(url), null);
  }

  /*
    A path segment that is not an id cannot reach the embed address. Without the format check the
    traversal would travel into the frame's src intact.
  */
  check("refused: a traversal in place of an id",
    parseVideoUrl("https://www.youtube.com/embed/../../evil"), null);

  console.log("\n--- the addresses that get built -------------------------------------");

  check("a YouTube embed is the no-cookie player",
    videoEmbedUrl({ provider: "YOUTUBE", videoId: "dQw4w9WgXcQ" }),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  check("a Vimeo embed is the player host",
    videoEmbedUrl({ provider: "VIMEO", videoId: "123456789" }),
    "https://player.vimeo.com/video/123456789");
  /*
    Rebuilt rather than echoed, so the twenty ways of writing one YouTube address collapse to one
    — and so a link this application prints cannot point somewhere the embed refused.
  */
  check("the watch link is rebuilt from the id, not the paste",
    videoWatchUrl(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=9")!),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  console.log("\n--- what a valid resource is -----------------------------------------");

  check("a link needs a URL",
    resourceSpecSchema.safeParse({ kind: "LINK", title: "MDN" }).success, false);
  check("...and refuses something that is not one",
    resourceSpecSchema.safeParse({ kind: "LINK", title: "MDN", url: "mdn" }).success, false);
  check("a note needs a body",
    resourceSpecSchema.safeParse({ kind: "TEXT", title: "Notes", body: "  " }).success, false);
  check("every kind needs a title",
    resourceSpecSchema.safeParse({ kind: "LINK", title: "  ", url: "https://a.example" }).success,
    false);
  const parsedLink = resourceSpecSchema.parse({
    kind: "LINK", title: "MDN", url: "https://a.example",
  });
  check("a description is optional and defaults to null",
    parsedLink.kind === "LINK" ? parsedLink.description : "wrong kind", null);
  /*
    A note has no URL field at all, so sending one is a spec for a different kind. Refused rather
    than ignored: silently dropping it would let a form send a link's fields under a note's kind
    and see it saved as something else.
  */
  check("a note carrying a URL is refused rather than trimmed",
    resourceSpecSchema.safeParse({
      kind: "TEXT", title: "Notes", body: "hello", url: "https://a.example",
    }).success,
    false);

  /*
    Every kind writes every column, so the ones it does not use are nulled rather than left
    holding whatever the previous kind put there. This is what makes changing a resource's kind
    safe: a note turned into a link must not keep its body.
  */
  const asLink = resourceColumns({
    kind: "LINK", title: "MDN", url: "https://a.example", description: null,
  });
  check("a link writes no body and no video", [asLink.body, asLink.videoId], [null, null]);
  const asText = resourceColumns({ kind: "TEXT", title: "Notes", body: "hello" });
  check("a note writes no url and no video", [asText.url, asText.videoId], [null, null]);
  const asVideo = resourceColumns({
    kind: "VIDEO", title: "Lecture", url: "https://youtu.be/dQw4w9WgXcQ",
  });
  check("a video stores its provider and id", [asVideo.videoProvider, asVideo.videoId],
    ["YOUTUBE", "dQw4w9WgXcQ"]);
  check("...and a canonical watch link rather than the paste",
    asVideo.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  check("...and no body", asVideo.body, null);

  check("an unrecognised video is refused at the column boundary too",
    await refusal(async () =>
      resourceColumns({ kind: "VIDEO", title: "x", url: "https://www.loom.com/share/a" })),
    "UnrecognisedVideoError");

  // =====================================================================================
  // The procedures, against the real database
  // =====================================================================================

  console.log("\n--- through the callers ----------------------------------------------");

  const course = await db.course.findFirst({
    where: { archivedAt: null, modules: { some: {} }, instructors: { some: {} } },
    select: {
      id: true,
      instructors: { take: 1, select: { userId: true } },
      modules: { orderBy: { position: "asc" }, take: 2, select: { id: true } },
    },
  });

  const enrollment = course
    ? await db.enrollment.findFirst({
        where: { courseId: course.id },
        select: { studentId: true },
      })
    : null;

  if (!course || !enrollment) {
    return skip("no seeded course with a module, an instructor, and a student");
  }

  const instructor = course.instructors[0]!;
  const firstModule = course.modules[0]!;
  const createCaller = createCallerFactory(appRouter);

  try {
    await db.$transaction(async (tx) => {
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
      const asStudent = createCaller({ db: tx, user: { id: enrollment.studentId } } as never);

      const before = (await asInstructor.resources.listForCourse({ courseId: course.id })).length;

      const link = await asInstructor.resources.create({
        moduleId: firstModule.id,
        spec: {
          kind: "LINK",
          title: "Verify Zebra",
          url: "https://developer.mozilla.org/",
          description: "  Read the first two sections.  ",
        },
      });
      check("a link is created", link.kind, "LINK");
      check("...with its description trimmed", link.description, "Read the first two sections.");

      const note = await asInstructor.resources.create({
        moduleId: firstModule.id,
        spec: { kind: "TEXT", title: "Verify Apple", body: "## Hello\n\nSome prose." },
      });
      check("a note is created with its markdown", note.body?.startsWith("## Hello"), true);

      const video = await asInstructor.resources.create({
        moduleId: firstModule.id,
        spec: { kind: "VIDEO", title: "Verify Mango", url: "https://youtu.be/dQw4w9WgXcQ" },
      });
      check("a video stores its provider", video.videoProvider, "YOUTUBE");

      check("an unrecognised video link is refused by the procedure, not only the form",
        await refusal(() =>
          asInstructor.resources.create({
            moduleId: firstModule.id,
            spec: { kind: "VIDEO", title: "Nope", url: "https://www.loom.com/share/a" },
          })),
        "BAD_REQUEST");

      // --- ordering ----------------------------------------------------------
      //
      // Alphabetical by title, decided on the server so the student page, the Modules screen,
      // and the Resources screen cannot each pick their own alphabet. Created deliberately out
      // of order above — Zebra, Apple, Mango — so insertion order cannot produce the answer.
      const listed = await asInstructor.resources.listForCourse({ courseId: course.id });
      const mine = listed
        .filter((row) => row.title.startsWith("Verify "))
        .map((row) => row.title);
      check("resources come back alphabetically, not in insertion order",
        mine, ["Verify Apple", "Verify Mango", "Verify Zebra"]);
      check("...and all three are there", listed.length, before + 3);

      /*
        A student reads exactly the same rows. There is no draft state on a resource, so unlike
        `assignments.listForCourse` this procedure has no publish filter — worth checking rather
        than assuming, because the neighbouring procedure does the opposite and a reader could
        reasonably expect either.
      */
      check("a student sees the same resources an instructor does",
        (await asStudent.resources.listForCourse({ courseId: course.id })).length, listed.length);

      // --- editing ------------------------------------------------------------
      const retyped = await asInstructor.resources.update({
        resourceId: note.id,
        spec: { kind: "LINK", title: "Verify Apple", url: "https://a.example", description: null },
      });
      /*
        The check that makes changing a kind safe. A note turned into a link keeps its title and
        loses its body — a row carrying both would be two things at once, and the next reader to
        trust either column renders something nobody wrote.
      */
      check("changing a kind clears the old kind's columns", [retyped.kind, retyped.body],
        ["LINK", null]);

      if (course.modules.length > 1) {
        const moved = await asInstructor.resources.update({
          resourceId: link.id,
          moduleId: course.modules[1]!.id,
          spec: { kind: "LINK", title: "Verify Zebra", url: "https://a.example", description: null },
        });
        check("a resource can be moved to another module of the same course",
          moved.moduleId, course.modules[1]!.id);
      } else {
        console.log("skip  moving between modules — the course has only one");
      }

      /*
        A module from another course is refused. Filed there, a resource is invisible on the
        course it belongs to and appears on one it does not, and nothing on either screen would
        explain it. The foreign key would accept it happily, which is why this is checked.
      */
      const elsewhere = await tx.module.findFirst({
        where: { courseId: { not: course.id } },
        select: { id: true },
      });
      if (elsewhere) {
        check("a module from another course is refused",
          await refusal(() =>
            asInstructor.resources.update({
              resourceId: link.id,
              moduleId: elsewhere.id,
              spec: { kind: "LINK", title: "Verify Zebra", url: "https://a.example", description: null },
            })),
          "BAD_REQUEST");
      } else {
        console.log("skip  a module from another course — none is seeded");
      }

      // --- where they appear ---------------------------------------------------
      //
      // The Modules screen and the student's course page both read them through
      // `modules.listForCourse`, so its own list has to carry them and in the same order.
      const modules = await asInstructor.modules.listForCourse({ courseId: course.id });
      const holding = modules.find((row) => row.id === firstModule.id);
      check("the module list carries its resources",
        (holding?.resources.length ?? 0) > 0, true);
      check("...in the same alphabetical order",
        holding!.resources.map((row) => row.title),
        [...holding!.resources.map((row) => row.title)].sort((a, b) => a.localeCompare(b)));

      // --- who may do any of this ----------------------------------------------
      check("a student cannot add a resource",
        await refusal(() =>
          asStudent.resources.create({
            moduleId: firstModule.id,
            spec: { kind: "LINK", title: "Nope", url: "https://a.example", description: null },
          })),
        "FORBIDDEN");
      check("a student cannot edit one",
        await refusal(() =>
          asStudent.resources.update({
            resourceId: video.id,
            spec: { kind: "LINK", title: "Nope", url: "https://a.example", description: null },
          })),
        "FORBIDDEN");
      check("a student cannot remove one",
        await refusal(() => asStudent.resources.remove({ resourceId: video.id })), "FORBIDDEN");

      /*
        The check the INSTRUCTOR role alone cannot make, asked as the question it is about rather
        than by a proxy for it. "An instructor who is not the one this script acts as" was the
        same question only while a course had one instructor.
      */
      const outsider = await tx.profile.findFirst({
        where: { role: "INSTRUCTOR", instructorOf: { none: { courseId: course.id } } },
        select: { id: true },
      });
      if (outsider) {
        const asOutsider = createCaller({ db: tx, user: { id: outsider.id } } as never);
        check("an instructor who does not teach the course cannot add a resource to it",
          await refusal(() =>
            asOutsider.resources.create({
              moduleId: firstModule.id,
              spec: { kind: "LINK", title: "Nope", url: "https://a.example", description: null },
            })),
          "FORBIDDEN");
        check("...nor edit one",
          await refusal(() =>
            asOutsider.resources.update({
              resourceId: video.id,
              spec: { kind: "LINK", title: "Nope", url: "https://a.example", description: null },
            })),
          "FORBIDDEN");
        check("...nor remove one",
          await refusal(() => asOutsider.resources.remove({ resourceId: video.id })), "FORBIDDEN");
      } else {
        console.log("skip  an instructor who does not teach the course — none is seeded");
      }

      // --- removing --------------------------------------------------------------
      check("a resource can be removed", (await asInstructor.resources.remove({
        resourceId: video.id,
      })).title, "Verify Mango");
      check("...and is gone from the list",
        (await asInstructor.resources.listForCourse({ courseId: course.id })).some(
          (row) => row.id === video.id,
        ),
        false);

      throw new Error("ROLLBACK");
    }, { timeout: 60_000 });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  /*
    ---- What the database does on its own -------------------------------------

    A resource cascades with its module, which is the opposite of what an assignment gets and
    right for the opposite reason: `modules.remove` refuses while assignments reference the
    module, because those carry submissions and grades. A resource carries a title and a link, so
    refusing to remove an otherwise-empty module because somebody left a reading in it would be a
    guard against nothing.
  */
  try {
    await db.$transaction(async (tx) => {
      const scratch = await tx.module.create({
        data: { courseId: course.id, name: "Verify Cascade Module", position: 9999 },
        select: { id: true },
      });
      await tx.resource.create({
        data: { moduleId: scratch.id, kind: "LINK", title: "Verify Cascade", url: "https://a.example" },
      });

      await tx.module.delete({ where: { id: scratch.id } });
      check("a resource is deleted with its module",
        await tx.resource.count({ where: { moduleId: scratch.id } }), 0);

      throw new Error("ROLLBACK");
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  // --- the rollback really rolled back ---------------------------------------
  check("no resources survived the rollback",
    await db.resource.count({ where: { title: { startsWith: "Verify " } } }), 0);
  check("...nor the module the cascade check made",
    await db.module.count({ where: { name: "Verify Cascade Module" } }), 0);

  return report();
}

/**
 * Groups of checks that did not run, and why.
 *
 * **A partial run must not read as a pass.** These scripts depend on seeded data, and the day
 * that data changes shape a whole group can stop running while the output still says everything
 * is fine. Reported, and non-zero.
 */
const skips: string[] = [];
function skip(reason: string) {
  skips.push(reason);
  console.log(`\nSKIPPED — ${reason}`);
}

function report() {
  if (failures > 0) console.log(`\n${failures} FAILED`);
  else if (skips.length === 0) console.log("\nAll checks passed.");
  else
    console.log(
      `\n${skips.length} group(s) did not run. Nothing failed, but this is not a pass.`,
    );

  if (failures > 0 || skips.length > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
