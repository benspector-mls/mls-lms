/**
 * Where "Send feedback" goes, and the one answer the application fills in on the way.
 *
 * The form itself is a Google Form rather than a screen in this application, and the responses
 * land in a spreadsheet rather than in the database. That is a deliberate choice about how much
 * machinery a feedback box is worth: a table here would need a migration, a private bucket for
 * screenshots with a provisioning step in both environments, a multipart upload route, and an
 * admin screen to read it — and it would answer no question the spreadsheet does not, until the
 * day feedback needs to be queried alongside grades. The form collects a *verified* email
 * address, which the responder cannot edit, so the one thing a database would have bought
 * outright — knowing who wrote this — is already covered.
 *
 * **Only the screen is filled in.** Whether the writer is a student or an instructor is a
 * multiple-choice question they answer themselves, which is both less code and better data: a
 * pre-filled box is editable anyway, so it never bought trust, only a saved click — and it
 * would have written `student` throughout an admin's test-student preview, which is not a
 * student but you, testing.
 *
 * Pure, with no `server-only`: the menu item that calls this is a client component.
 */

/** The form's own address, without any pre-filled answers. */
const FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSeDocc3i372uImIBzfK9kSjFrUtOLGVZcjEUDMoYREqE60AdA/viewform";

/**
 * The one question this application answers rather than the person.
 *
 * The identifier comes from the form editor's ⋮ menu → **Get pre-filled link**, which walks you
 * through the form and hands back a URL carrying one `entry.NNNNNNNNN` parameter per question
 * you typed into. It belongs to the question itself, so renaming it, reordering the form, or
 * moving it to another section all leave it alone. Deleting the question and creating a new one
 * in its place does not: that mints a fresh identifier, and a rebuilt form means fetching a new
 * pre-filled link and changing this.
 *
 * **The question has to sit in the form's first section**, which every responder passes through
 * whatever they answer. Google Forms records answers only from the sections a person actually
 * visits, so a pre-filled answer in a section the branching skips is discarded along with the
 * section — the spreadsheet column simply comes back empty, with nothing to say why.
 *
 * **It is a short-answer question rather than multiple choice**, for a reason worth keeping: a
 * pre-filled value for a multiple-choice question has to match one of its options character for
 * character or Google ignores it in silence.
 */
const SCREEN_FIELD = "entry.309563249";

/**
 * The form's address with the screen already answered.
 *
 * This is the reason the function exists. A bug report that says "the page was blank" is a
 * conversation; one that says "/courses/<id>/gradebook?cohort=<id> was blank" is a place to
 * look, and the person reporting it should not have to know the address of the screen they are
 * on.
 *
 * **The query string is included, and it is the half that carries what the reader had chosen** —
 * which cohort the gradebook is filtered to, which submission the grading queue has open. Both
 * survive to the moment the menu is opened, because neither is an overlay.
 *
 * **One thing it cannot capture, by design rather than by omission.** A panel that closes when
 * you press outside it — the student's assignment panel is the one here — has already dropped
 * its `?assignment=` parameter by the time the menu opens, because reaching the menu is that
 * press. The answer is the form's own: the field is an ordinary editable box, and its help text
 * asks the reader to paste the address themselves when it does not match the screen they mean.
 * Capturing it in code would mean racing the panel's dismissal on every press, which is a great
 * deal of cleverness to save one paste.
 *
 * `searchParams.set` encodes the value, so a path carrying an id needs nothing done to it here.
 */
export function feedbackFormUrl(params: { pathname: string; search: string }): string {
  const url = new URL(FORM_URL);
  // What tells Google these parameters are answers rather than anything else in a query string.
  url.searchParams.set("usp", "pp_url");
  url.searchParams.set(
    SCREEN_FIELD,
    params.search ? `${params.pathname}?${params.search}` : params.pathname,
  );
  return url.toString();
}
