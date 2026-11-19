/**
 * A lesson's title from `SUMMARY.md`, with its `code` spans drawn as code.
 *
 * Titles such as "2.1 Intro to OOP, Classes, `__init__`, and `self`" name Python identifiers, and
 * shown with their backticks they read as a typing mistake. A title holds no other markdown, so
 * splitting on backticks is the whole of it: every second piece is code.
 */
export function LessonTitle({ title }: { title: string }) {
  return (
    <>
      {title.split("`").map((piece, index) =>
        index % 2 === 1 ? (
          <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {piece}
          </code>
        ) : (
          piece
        ),
      )}
    </>
  );
}
