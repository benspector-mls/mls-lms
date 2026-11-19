/**
 * The lesson text sizes the Magnify menu offers, as multiples of the application's own size.
 *
 * Lesson text only: `LessonMarkdown` sizes its text from `--lesson-text-scale` and everything inside
 * it in `em`, so the words, headings, code, tables and callouts grow together, while the tree, the
 * outline and the rest of the application stay as they are. The browser's own zoom already
 * enlarges everything.
 *
 * Its own module, without `"use client"`, because the lessons layout — a server component — reads
 * the script below as a string, and a value exported from a client module reaches the server as a
 * reference rather than as its contents.
 */
export const LESSON_TEXT_SIZES = {
  default: { label: "Default", scale: 1 },
  large: { label: "Large", scale: 1.125 },
  larger: { label: "Larger", scale: 1.25 },
} as const;
export type LessonTextSize = keyof typeof LESSON_TEXT_SIZES;

/**
 * Where the choice is kept: this browser's storage, so it follows the computer rather than the
 * account and needs no column. On a shared classroom computer the next reader starts with it.
 */
export const LESSON_TEXT_SIZE_KEY = "lesson-text-size";

/** A stored value that names one of the sizes, and not a name every object has, such as `constructor`. */
export function isLessonTextSize(value: unknown): value is LessonTextSize {
  return typeof value === "string" && Object.hasOwn(LESSON_TEXT_SIZES, value);
}

/**
 * Applies the saved size before the lesson is first drawn on a full page load, so the text does
 * not appear at the default size and then jump. The lessons layout writes it as an inline script
 * above the lesson; it runs as the page is read, before the lesson beneath it is painted. Storage
 * can be refused, as in some private windows, and the lesson then stays at the default size.
 */
export const LESSON_TEXT_SIZE_SCRIPT = `try{var s=localStorage.getItem(${JSON.stringify(
  LESSON_TEXT_SIZE_KEY,
)});var m=${JSON.stringify(
  Object.fromEntries(Object.entries(LESSON_TEXT_SIZES).map(([key, value]) => [key, value.scale])),
)};if(s&&Object.prototype.hasOwnProperty.call(m,s))document.documentElement.style.setProperty("--lesson-text-scale",String(m[s]));}catch(e){}`;
