import { redirect } from 'next/navigation';

/**
 * There is no landing page. Everyone who reaches this application already has an
 * account — students are enrolled by an instructor, instructors are added to a course —
 * so the root sends them to their courses, and the middleware sends them to sign in if
 * they are not signed in yet.
 */
export default function Home() {
  redirect('/courses');
}
