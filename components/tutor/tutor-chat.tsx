"use client";

import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { MAX_QUESTION_LENGTH } from "@/lib/tutor/limits";
import { cn } from "@/lib/utils";
import { useTRPC, useTRPCClient } from "@/trpc/client";
import type { RouterInputs, RouterOutputs } from "@/trpc/types";

/** The course's own conversation, or one assignment's. */
export type TutorScope = { assignmentId?: string };

type Turn = RouterOutputs["tutor"]["history"]["turns"][number];
type Question = RouterInputs["tutor"]["ask"];

/** What a TUTOR turn's `sources` holds, written by `tutor.ask`. */
type Source = { slug: string; anchor: string; heading: string; title: string };

/**
 * The chat with the Tutor: the conversation so far, the box for the next question, and the line
 * saying who else can read it. On the Tutor page it is about the course's lessons; on the
 * assignment panel's Tutor tab, about that assignment.
 *
 * **An answer is shown as it is written.** The question appears at once, the box says it is
 * thinking until the first words arrive, and the answer grows under it. The stream's text is
 * Claude's own; the two stored turns arrive last, with the fellow's name put back, and replace
 * it. They are added to the fetched conversation rather than refetched, and a refusal, before or
 * during the answer, drops what was shown and puts the question back in the box to be sent again.
 *
 * **Nothing can be sent under a read-only view.** The server refuses every write there; this
 * greys the box so it does not offer what will be refused.
 */
export function TutorChat({
  courseId,
  scope,
  audience,
  lessonsBase,
  disabled = false,
  draft: heldDraft,
  onDraftChange,
}: {
  courseId: string;
  scope: TutorScope;
  /** Who is asking, which decides who else the box says can read the conversation. */
  audience: "fellow" | "instructor";
  /** The course's lessons address on the reader's side, for the "References" links. */
  lessonsBase: string;
  /** An instructor reading a fellow's assignment panel: shown, and nothing can be sent. */
  disabled?: boolean;
  /**
   * The question being typed, when the parent holds it: the assignment panel unmounts a tab that
   * is not showing, and a question half typed before a look at the Feedback tab would be lost
   * with the box. Both or neither.
   */
  draft?: string;
  onDraftChange?: (draft: string) => void;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const [ownDraft, setOwnDraft] = React.useState("");
  /** The answer so far while it is being written; null before its first words and after it is stored. */
  const [partial, setPartial] = React.useState<string | null>(null);
  /**
   * Whether the box is folded to one line. A long question being written fills the window, and
   * the answer it responds to is behind it; folding shows the answer again without losing what
   * was typed, since the editor is hidden rather than taken down.
   */
  const [folded, setFolded] = React.useState(false);
  const draft = heldDraft ?? ownDraft;
  const setDraft = onDraftChange ?? setOwnDraft;
  const endRef = React.useRef<HTMLDivElement>(null);

  const viewing = useQuery(trpc.viewingAs.queryOptions());
  const readOnly = disabled || viewing.data?.readOnly === true;

  const historyOptions = trpc.tutor.history.queryOptions({ courseId, scope });
  const history = useQuery(historyOptions);
  const turns = history.data?.turns ?? [];

  const askKey = trpc.tutor.ask.mutationKey();

  /*
    The question being answered, read from the mutation itself rather than from this hook's
    `isPending`: the assignment panel unmounts the tab, and a tab drawn again while the answer is
    still on its way must show the question as pending, or the fellow sends it again. The key is
    shared by every conversation, so this conversation's own is picked out.
  */
  const inFlight = useMutationState({
    filters: { mutationKey: askKey, status: "pending" },
    select: (mutation) => mutation.state.variables as Question,
  }).find(
    (question) =>
      question.courseId === courseId &&
      (question.scope.assignmentId ?? null) === (scope.assignmentId ?? null),
  );
  const pending = inFlight !== undefined;

  const ask = useMutation({
    mutationKey: askKey,
    /*
      Everything that follows the answer is in the function itself rather than in `onSuccess` and
      `onError`, which belong to this hook and are lost with the tab while the mutation runs on.
      The function reads the stream to its end, so the mutation is pending until the answer is
      complete, and then puts the two stored turns into the fetched conversation. The function
      `mutationOptions()` would give resolves as soon as the stream opens.
    */
    mutationFn: async (question: Question) => {
      try {
        let turns: Turn[] | undefined;
        for await (const chunk of await client.tutor.ask.mutate(question)) {
          if (chunk.type === "text") setPartial((text) => (text ?? "") + chunk.text);
          else turns = chunk.turns;
        }
        if (!turns) throw new Error("The answer ended before it was complete. Ask again.");
        const stored = turns;
        // A refetch that landed meanwhile already holds the stored question; each turn goes in once.
        queryClient.setQueryData(historyOptions.queryKey, (old) => ({
          turns: [
            ...(old?.turns ?? []).filter((turn) => !stored.some((t) => t.id === turn.id)),
            ...stored,
          ],
        }));
        return { turns: stored };
      } catch (err) {
        // A refusal, before or during the answer, puts the question back in the box.
        setDraft(question.message);
        throw err;
      } finally {
        setPartial(null);
      }
    },
    // Emptied as the question leaves rather than when it is answered: a box drawn afresh in
    // the meantime, as the assignment panel does when its tab changes, would otherwise offer
    // the same question to send again.
    onMutate: () => {
      setDraft("");
      setPartial(null);
    },
  });

  // The newest words into view as they are drawn, without moving the page when nothing changed.
  React.useEffect(() => {
    if (turns.length > 0 || pending) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, pending, partial]);

  // Not before the conversation has loaded: a fetch still in flight would land after the answer
  // and replace the two new turns with the list from before them.
  const canSend = !readOnly && !pending && history.data !== undefined;

  const send = () => {
    const message = draft.trim();
    if (message === "" || !canSend) return;
    ask.mutate({ courseId, scope, message });
  };

  const about = scope.assignmentId ? "assignment" : "course";

  // A refetch that landed meanwhile may already hold the stored question, shown in its place.
  const showsInFlight = inFlight !== undefined && turns.at(-1)?.role !== "USER";

  /*
    The conversation as exchanges, a question and its answer, each drawn in one list item. The
    question sticks to the top of the window only within its item, so it leaves with its answer
    and the next question takes the place; stuck in one list, every question would pile up at
    the same point. The question being answered is the last exchange, with the answer so far.
  */
  const exchanges: { key: string; question?: string; answer?: Turn; pending?: boolean }[] = [];
  for (const turn of turns) {
    const last = exchanges.at(-1);
    if (turn.role === "USER") exchanges.push({ key: turn.id, question: turn.content });
    else if (last && last.answer === undefined) last.answer = turn;
    else exchanges.push({ key: turn.id, answer: turn });
  }
  if (showsInFlight) exchanges.push({ key: "asking", question: inFlight.message });
  if (pending) {
    const last = exchanges.at(-1);
    if (last && last.answer === undefined) last.pending = true;
    else exchanges.push({ key: "asking", pending: true });
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-3" aria-live="polite">
        {history.isPending ? (
          <li className="text-sm text-muted-foreground">Loading the conversation…</li>
        ) : history.isError ? (
          <li className="text-sm text-destructive">{history.error.message}</li>
        ) : turns.length === 0 && !pending ? (
          <li className="text-sm text-muted-foreground">
            {about === "course"
              ? "Ask about anything in this course's lessons: what a term means, why an example works, or what to read next. The Tutor answers from the lessons and names the ones to read."
              : "Ask what the assignment is asking for, or about an idea it uses. The Tutor explains and points to the lessons; it does not write your code."}
          </li>
        ) : (
          exchanges.map((exchange) => (
            <li key={exchange.key} className="flex flex-col gap-3">
              {exchange.question !== undefined && <Question content={exchange.question} />}
              {exchange.answer && <Answer turn={exchange.answer} lessonsBase={lessonsBase} />}
              {exchange.pending &&
                (partial === null ? (
                  <p className="text-sm text-muted-foreground">Thinking…</p>
                ) : (
                  <Markdown className="text-sm" content={partial} />
                ))}
            </li>
          ))
        )}
      </ol>

      {/*
        The box stays at the foot of the window while the conversation scrolls behind it, so a
        fellow returning to a long conversation can ask without first scrolling to its end. It is
        opaque, with a line above it, so the words passing under it are not read through it.
      */}
      <form
        className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-border bg-background pt-3 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {folded && (
          <button
            type="button"
            onClick={() => setFolded(false)}
            className="flex items-center justify-between gap-2 rounded-lg border border-input px-3 py-2 text-left text-sm"
            aria-label="Expand the question box"
          >
            <span className={cn("truncate", draft.trim() === "" && "text-muted-foreground")}>
              {draft.trim() === "" ? "Your question" : draft.split("\n")[0]}
            </span>
            <ChevronUp aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </button>
        )}
        <div className={cn("flex flex-col gap-2", folded && "hidden")}>
          <MarkdownEditor
            value={draft}
            onChange={setDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                send();
              }
            }}
            maxLength={MAX_QUESTION_LENGTH}
            rows={3}
            disabled={!canSend}
            placeholder={about === "course" ? "Ask about the lessons" : "Ask about this assignment"}
            ariaLabel="Your question"
            // Capped so a long question scrolls inside the box instead of filling the window.
            className="max-h-[40svh] overflow-y-auto"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {audience === "fellow"
                ? "Instructors can read this conversation."
                : "Only you can see this conversation."}
            </p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setFolded(true)}
                aria-label="Collapse the question box"
              >
                <ChevronDown aria-hidden />
              </Button>
              <Button type="submit" size="sm" disabled={!canSend || draft.trim() === ""}>
                {pending ? "Thinking…" : "Ask"}
              </Button>
            </div>
          </div>
        </div>
        {ask.error && (
          <p className="text-sm text-destructive" role="alert">
            {ask.error.message}
          </p>
        )}
      </form>
      {/* After the box, so scrolling here brings the end of the conversation out from under it. */}
      <div ref={endRef} aria-hidden className="h-0" />
    </div>
  );
}

/** A question taller than this, in pixels, folds to its first line until it is opened. */
const FOLDED_HEIGHT = 44;

/**
 * The fellow's question, on the right, as the Markdown they wrote. It stays at the top of the
 * window while the answer below it is read, as a lesson's headings do, so whichever answer is in
 * view is read under the question that produced it. The row around the bubble is transparent and
 * the bubble nearly so, so the answer is seen passing beneath. It sticks at `--tutor-sticky-top`:
 * the chrome above the page on the Tutor page, where the page scrolls, and nothing on an
 * assignment's panel, whose Tutor tab scrolls inside its own box, where an offset pushes the
 * first question down from the top of the box by that much.
 *
 * **A long question folds to its first line**, with the second fading out, so that stuck at the
 * top it does not hide the answer being read. The fold is measured from the drawn height, since
 * a line of Markdown may be a paragraph or a block of code, and the button opens it in place.
 */
function Question({ content }: { content: string }) {
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [tall, setTall] = React.useState(false);
  const [opened, setOpened] = React.useState(false);
  React.useEffect(() => {
    const body = bodyRef.current;
    if (body) setTall(body.scrollHeight > FOLDED_HEIGHT + 8);
  }, [content]);
  const folded = tall && !opened;

  return (
    <div className="sticky top-[var(--tutor-sticky-top,0px)] z-[5] flex justify-end py-1">
      {/* No backdrop blur: a blurred element inside a sticky one is composited apart and was drawn over the chrome. */}
      <div className="relative max-w-[85%] rounded-lg bg-sky-100/95 px-3 py-2 dark:bg-sky-900/95">
        <div ref={bodyRef} className={cn("overflow-hidden", tall && "pr-7", folded && "max-h-11")}>
          <Markdown className="text-sm" content={content} />
        </div>
        {folded && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-6 rounded-b-lg bg-gradient-to-t from-sky-100 to-transparent dark:from-sky-900"
          />
        )}
        {tall && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute top-1 right-1"
            onClick={() => setOpened((open) => !open)}
            aria-label={folded ? "Show the whole question" : "Fold the question"}
          >
            {folded ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The Tutor's answer as Markdown, with the sections it was given as references. */
function Answer({ turn, lessonsBase }: { turn: Turn; lessonsBase: string }) {
  const sources = (turn.sources ?? []) as Source[];
  return (
    <div className={cn("flex flex-col gap-2", sources.length > 0 && "pb-1")}>
      <Markdown className="text-sm" content={turn.content} />
      {sources.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <p>References:</p>
          <ul className="list-disc pl-5">
            {sources.map((source) => (
              <li key={`${source.slug}#${source.anchor}`}>
                <Link
                  href={`${lessonsBase}/${source.slug}${source.anchor ? `#${source.anchor}` : ""}`}
                  className="underline underline-offset-2"
                >
                  {source.title} › {source.heading}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
