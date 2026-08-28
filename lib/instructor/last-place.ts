import { isUuid } from "../auth/view-as";

/**
 * Where an instructor was when they last closed the tab, so that opening the application returns
 * them to it rather than to a guess.
 *
 * **The URL is still the only record of where you *are*.** The sidebar and the breadcrumb read the
 * address and nothing else, which is what stops either of them naming a course the screen is not
 * about. This is consulted at exactly one place — `/instructor`, which names no scope and until now
 * guessed — so it is the same precedence rule the remembered cohort already follows in
 * `resolveCohort`: the address wins wherever it says anything, and the remembered value fills in
 * only where it is silent.
 *
 * **One value covers both scopes.** An instructor building next term's program is looking at a
 * program address, and a program is created with no courses at all, so remembering "the last
 * course" would have nothing to record for the case the feature most exists for. Remembering the
 * last *view*, whichever scope it belongs to, needs no second value and no rule for choosing
 * between two.
 */

/**
 * The cookie's name.
 *
 * `mls_` prefixed to keep it clear of Supabase's own `sb-*` cookies, the way `VIEW_AS_COOKIE` is.
 */
export const LAST_PLACE_COOKIE = "mls_last_place";

/** Thirty days, in seconds. Long enough to cover a holiday, short enough to expire a stale term. */
export const LAST_PLACE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * The address to remember for a screen, or null for a screen not worth remembering.
 *
 * **It truncates.** Everything after the view segment is discarded, so an assignment's grading
 * queue and its edit form are both remembered as the course's Curriculum, and one day of attendance
 * is remembered as the program's Attendance. That is deliberate: an assignment can be deleted
 * between one sitting and the next, and returning somebody to a screen that reports it cannot find
 * the thing is worse than returning them to the list it was in. The answers it gives are the ones
 * the sidebar's own highlighting gives, because both are asking which view a screen belongs to.
 *
 * **Null where the address lights no sidebar item**, which is the two fellow-record screens and
 * everything outside `/instructor`. Recording nothing leaves the previous value standing, so
 * clicking from a course's triage into a fellow's work and then closing the tab returns you to that
 * triage — which is where the fellow's record was reached from and where the work continues.
 * A fellow's own screens never reach here at all, so no student and no admin previewing as a test
 * student ever writes this cookie.
 *
 * **The same function reads an in-app pathname and an untrusted cookie**, and is safe for both
 * because it never echoes its input: the string it returns is built from a scope it recognised, an
 * id it checked the shape of, and a segment from its own list. A value from a cookie is a value
 * somebody can set, and a path built from one that was never checked is how a redirect becomes
 * somebody else's — which is the care `app/api/view-as/exit/route.ts` takes for the same reason.
 */
export function viewPlaceOf(path: string): Place | null {
  // Only the first four segments are named, so anything deeper is discarded by not being read.
  const [instructor, scope, id, segment] = path.split("/").filter(Boolean);

  if (instructor !== "instructor") return null;
  if (!id || !isUuid(id)) return null;
  if (!segment) return null;

  const views = scope === "courses" ? COURSE_VIEWS : scope === "programs" ? PROGRAM_VIEWS : null;
  if (!views || !(views as readonly string[]).includes(segment)) return null;

  return { scope: scope as Place["scope"], id, href: `/instructor/${scope}/${id}/${segment}` };
}

/**
 * A remembered view: which of the two scopes it belongs to, which one, and the address itself.
 *
 * The scope and the id are returned beside the address rather than left to be read back out of it,
 * because the one caller that goes there has to check the id against the caller's own courses or
 * programs first, and taking apart a string this function just put together would be two chances to
 * disagree about its shape.
 */
export type Place = {
  scope: "courses" | "programs";
  id: string;
  href: string;
};

/**
 * The five views a course has and the three a program has, as segments.
 *
 * They are the sidebar's two groups, and `COURSE_VIEWS` and `PROGRAM_VIEWS` in `app-shell.tsx` are
 * the same two lists with a title, an icon and an href builder on each. Held separately rather than
 * imported from there because that module is a client component and this one is read by
 * `/instructor`, which is a Server Component — and duplicating three words is cheaper than the
 * machinery that sharing across that boundary would need.
 *
 * A view added to the sidebar and forgotten here is not remembered, and the reader lands on the
 * view they were on before it. That is the whole cost of the two lists disagreeing.
 */
const COURSE_VIEWS = ["triage", "gradebook", "curriculum", "teams", "settings"] as const;
const PROGRAM_VIEWS = ["attendance", "roster", "settings"] as const;
