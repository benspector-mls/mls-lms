import { redirect } from "next/navigation";

/**
 * There is no landing page. Everyone who reaches this application already has an
 * account — students are enrolled by an instructor, instructors are added to a course —
 * so the root sends them to their work, and the middleware sends them to sign in if
 * they are not signed in yet.
 *
 * One destination for everybody, and the role check is on `/dashboard` rather than here.
 * Deciding it here would mean reading the profile before redirecting, which is a database
 * round trip on the way to a screen that is about to make the same read — and the two
 * client-side sign-in paths that also land here have no role to read at all. So one
 * destination, which forwards an instructor to their grading queue.
 */
export default function Home() {
  redirect("/dashboard");
}
