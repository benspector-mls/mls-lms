import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,

  /**
   * The instructor's assignments section became the coursework section, because it now holds
   * assessments and projects as well.
   *
   * Every link inside the application goes through `lib/links.ts` and moved with it. These are
   * for the addresses that live outside it — a bookmark, a link in a message to a co-teacher,
   * a browser's history — which would otherwise 404 on a page that still exists under a new
   * name.
   *
   * **Not permanent.** A 308 is cached by the browser indefinitely, so a permanent redirect on
   * a path this application may want back is a decision that cannot be taken back on a machine
   * that has already followed it once. The cost of a temporary one is a redirect per visit to
   * an address nothing links to any more.
   */
  async redirects() {
    /*
      The addresses Curriculum replaced.

      Modules, Coursework, and Resources were three screens because a project used to be a
      different kind of row from a module. All three are course units now, so there is one screen
      — and a bookmark or a link somebody kept still lands on the page it names rather than on a
      404. Temporary rather than permanent: a permanent redirect is cached by the browser forever,
      which is not a thing to hand out while the routes are still settling.
    */
    const gone = ["assignments", "coursework", "modules", "resources"];

    return gone.flatMap((segment) => [
      {
        source: `/instructor/courses/:courseId/${segment}`,
        destination: "/instructor/courses/:courseId/curriculum",
        permanent: false,
      },
      {
        // The deeper addresses: one assignment's grading queue, its edit form, and `new`.
        source: `/instructor/courses/:courseId/${segment}/:rest*`,
        destination: "/instructor/courses/:courseId/curriculum/:rest*",
        permanent: false,
      },
    ]);
  },
};

export default nextConfig;
