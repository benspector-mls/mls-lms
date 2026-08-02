import Link from 'next/link';
import { Suspense } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * `cacheComponents` is enabled in next.config.ts, which means a route cannot
 * block on per-request data outside a Suspense boundary. Everything here depends
 * on who is signed in, so the page component renders a static shell and the
 * dynamic read happens in an async child inside <Suspense>. This is the same
 * pattern the starter's /protected page uses.
 *
 * Unauthenticated visitors never reach this page: the middleware in
 * lib/supabase/proxy.ts redirects them to /auth/login first.
 */
export default function CoursesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Your courses</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading courses…</p>}>
        <CourseList />
      </Suspense>
    </main>
  );
}

/**
 * A server component calling the tRPC procedures directly in this process rather
 * than over HTTP, so there is no client JavaScript for these reads.
 */
async function CourseList() {
  const queryClient = getQueryClient();
  const [profile, courses] = await Promise.all([
    queryClient.fetchQuery(trpc.me.queryOptions()),
    queryClient.fetchQuery(trpc.courses.listMine.queryOptions()),
  ]);

  return (
    <>
      {profile && (
        <div className="flex justify-end">
          <Badge variant="outline">{profile.role}</Badge>
        </div>
      )}

      {profile && !profile.githubUsername && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="text-base">GitHub account not linked</CardTitle>
            <CardDescription>
              Accepting an assignment creates a repository named after your GitHub username, so you
              need to sign in with GitHub at least once before you can accept anything. Sign out and
              choose &ldquo;Sign in with GitHub&rdquo;.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {courses.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No courses yet</CardTitle>
            <CardDescription>
              You are not enrolled in a course and do not teach one. Run{' '}
              <code>npm run db:seed</code> to create the test course.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {courses.map((course) => (
        <Card key={course.id}>
          <CardHeader>
            <CardTitle className="text-base">
              <Link href={`/courses/${course.id}`} className="underline underline-offset-4">
                {course.name}
              </Link>
            </CardTitle>
            <CardDescription>{course.cohortTerm}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {Array.isArray(course.moduleStructure) ? course.moduleStructure.length : 0} modules
          </CardContent>
        </Card>
      ))}
    </>
  );
}
