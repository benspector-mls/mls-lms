import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { NextResponse } from "next/server";

import { db } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { formatBytes, MAX_UPLOAD_BYTES } from "@/lib/uploads/file-types";
import { assertCanHandIn, storeAndRecordUpload } from "@/lib/uploads/submit";

/**
 * A student handing in a file.
 *
 * **Why this is a route handler and not a tRPC mutation.** tRPC's transport is JSON, so a file
 * would have to be base64'd into a request body — a third larger, held in memory twice, and
 * serialized through superjson on the way. A multipart request is what browsers already do
 * with files. The authorization rule does not live here: `assertCanHandIn` is the same
 * function `submissions.submitWork` calls, so there is one implementation of who may submit
 * rather than one per transport, and the `TRPCError` it throws is mapped to a status below.
 *
 * **Why one request rather than a signed upload URL.** The alternative — mint a signed URL,
 * let the browser upload straight to storage, then call back to record it — has a window
 * where the object exists and the submission was never marked handed in. A student who closed
 * the tab in that window has work in a bucket that nothing points at and no instructor will
 * ever see, which is precisely the failure `submitWork` exists to prevent. Sending the bytes
 * through here costs one function invocation and closes it.
 */

/** Comfortably under the platform's own body limit, and far above MAX_UPLOAD_BYTES. */
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    // getUser() rather than getSession(), for the reason createTRPCContext gives: getSession
    // trusts the cookie, which on the server means a forged one would authenticate.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be signed in to do that." });
    }

    const profile = await db.profile.findUnique({
      where: { id: user.id },
      select: { id: true },
    });

    if (!profile) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Your account has no profile record. This should not happen — please report it.",
      });
    }

    const form = await request.formData();
    const assignmentId = form.get("assignmentId");
    const file = form.get("file");

    if (typeof assignmentId !== "string" || assignmentId.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No assignment was named." });
    }

    if (!(file instanceof File)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No file was attached." });
    }

    /*
      Checked before the bytes are read into memory, not after. `file.size` is known from the
      multipart headers, so refusing here means an oversized upload costs one comparison
      instead of 25MB of allocation — and the browser is asked to check the same thing first,
      so reaching this is either an old tab or someone bypassing the form.
    */
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `That file is ${formatBytes(file.size)}, and the limit is ` +
          `${formatBytes(MAX_UPLOAD_BYTES)}.`,
      });
    }

    const assignment = await assertCanHandIn(db, {
      profileId: profile.id,
      assignmentId,
      expect: "file",
    });

    const submission = await storeAndRecordUpload(db, {
      profileId: profile.id,
      assignment,
      filename: file.name,
      // What the browser claimed is deliberately not passed at all. The extension decides both
      // whether the file is accepted and what type it is stored under — see `checkUpload` —
      // because browsers disagree about the same file, and the bucket's allow-list is built
      // from those same entries.
      bytes: Buffer.from(await file.arrayBuffer()),
    });

    return NextResponse.json({ submission });
  } catch (err) {
    if (err instanceof TRPCError) {
      return NextResponse.json({ error: err.message }, { status: getHTTPStatusCodeFromError(err) });
    }

    // Never the underlying message. A storage failure names the bucket and the path, which is
    // for the log rather than for a student.
    console.error("submission upload failed", err);
    return NextResponse.json(
      {
        error:
          "Something went wrong storing that file. Try again, and tell your instructor if it keeps happening.",
      },
      { status: 500 },
    );
  }
}
