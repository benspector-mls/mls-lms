"use client";

import { Check, CircleCheck, Copy, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { HighlightedCode, textOf } from "@/components/markdown";
import { languageForFence } from "@/lib/diff/languages";
import { DRIVE_DOC_KIND_LABEL, driveEmbedUrl, parseDriveDocUrl } from "@/lib/drive/embed";
import { gitbookToHtml } from "@/lib/lessons/gitbook";
import { rehypeLesson, type LessonLinkOptions } from "@/lib/lessons/rehype-lesson";
import { cn } from "@/lib/utils";

/**
 * One lesson's markdown, drawn the way GitBook draws it.
 *
 * **Its own component rather than `components/markdown.tsx`.** That one draws feedback and short
 * responses: every link opens in a new tab, and each element is rebuilt from its children alone, so
 * an element's attributes never reach the page. A lesson needs both of the things that drops — links
 * between lessons that open in place, and headings that keep the ids its in-page links point at —
 * and twelve screens depend on the other component behaving as it does. The two share the code
 * highlighting, which is the one part that is the same.
 *
 * The steps, in order:
 *
 * 1. `gitbookToHtml` turns the GitBook block tags into HTML lines (`lib/lessons/gitbook.ts`).
 * 2. `remark-gfm` reads tables, task lists and strikethrough.
 * 3. `rehype-raw` reads the HTML the lessons contain — 218 `<details>` dropdowns, the converted
 *    tags, a few `<img>` and `<kbd>` — which react-markdown otherwise prints as text.
 * 4. `rehype-sanitize` drops any HTML outside `lessonSanitizeSchema`.
 * 5. `rehypeLesson` gives headings their ids and rewrites links and images
 *    (`lib/lessons/rehype-lesson.ts`).
 */
export function LessonMarkdown({ body, links }: { body: string; links: LessonLinkOptions }) {
  const content = React.useMemo(() => gitbookToHtml(body), [body]);

  /*
    A link to a section of another lesson — a search result, or a link inside a lesson — arrives
    while the page still shows its loading placeholder. Next.js looks for the `#section` then, finds
    nothing, and does not look again once the lesson is drawn, so the reader lands at the top. The
    lesson looks for the section itself once it is drawn.
  */
  React.useEffect(() => {
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      // A hand-typed `#` holding a stray `%`; no section has such an id.
      return;
    }
    if (id !== "") document.getElementById(id)?.scrollIntoView();
  }, [body]);

  return (
    /*
      The text size comes from `--lesson-text-scale`, which the Magnify menu sets, and every size
      inside is in `em`, so the headings, code, tables and callouts grow with the words.
    */
    <div className="marcy-md text-[calc(1rem_*_var(--lesson-text-scale,1))] leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={{ allowDangerousHtml: true }}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, lessonSanitizeSchema], [rehypeLesson, links]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * What raw HTML a lesson may contain, which is GitHub's list plus what the lessons and the GitBook
 * conversion need.
 *
 * Lessons come from a repository only Marcy staff can push to, so this guards against mistakes
 * rather than attackers. It is still a list of what is allowed rather than of what is not: every
 * fellow opens these pages signed in, and the standing decision against embedding arbitrary HTML
 * in the LMS holds for a lesson as much as for a submission. A script tag, a frame or an inline
 * event handler written into a lesson is dropped.
 *
 * Added to GitHub's list: `aside` with `data-hint`, and `div` with `data-code-title` or
 * `data-embed`, which are what `gitbookToHtml` turns the GitBook tags into; and `figure` and
 * `figcaption`, which one lesson writes by hand around an image. `details`, `summary`, `kbd` and
 * `img` with `width` are in GitHub's list already.
 *
 * **Ids are kept as written.** GitHub's list prefixes every id with `user-content-`, which is what
 * a page holding writing from strangers needs; here it would break a footnote, whose link already
 * carries the prefix, and an anchor an author wrote by hand, whose links do not.
 */
const lessonSanitizeSchema = {
  ...defaultSchema,
  clobber: [],
  tagNames: [...(defaultSchema.tagNames ?? []), "aside", "figure", "figcaption"],
  attributes: {
    ...defaultSchema.attributes,
    aside: ["dataHint"],
    div: [...(defaultSchema.attributes?.div ?? []), "dataCodeTitle", "dataEmbed"],
  },
};

/*
  Every heading carries `scroll-mt-(--outline-offset)`, so a jump from the outline or from a link
  lands the heading below the shell's sticky header rather than underneath it. A heading inside a
  section lands a further 3rem down, scaled with the text size, below its section's stuck `##`
  heading, which would otherwise cover it.
*/
const heading = "scroll-mt-(--outline-offset) font-semibold tracking-tight";
const underStuckHeading =
  "scroll-mt-[calc(var(--outline-offset)_+_3rem_*_var(--lesson-text-scale,1))]";

const components: Components = {
  h1: ({ id, children }) => (
    <h1 id={id} className={cn(heading, "mt-2 mb-4 text-[1.5em] text-balance first:mt-0")}>
      {children}
    </h1>
  ),
  /*
    Sticky, so the heading of the section being read stays in view; `wrapSections` gives each one a
    section of its own, which is what lets the next heading push it away.
  */
  h2: ({ id, children }) => (
    <h2
      id={id}
      className={cn(
        heading,
        "sticky top-(--outline-sticky-top) z-[5] mt-10 mb-3 border-b border-border bg-background pt-2 pb-1 text-[1.25em]",
      )}
    >
      {children}
    </h2>
  ),
  // Each `##` heading's section carries its id; see `wrapSections`.
  section: ({ id, children }) => (
    <section id={id} className="scroll-mt-(--outline-offset)">
      {children}
    </section>
  ),
  h3: ({ id, children }) => (
    <h3 id={id} className={cn(heading, underStuckHeading, "mt-8 mb-2 text-[1.125em]")}>
      {children}
    </h3>
  ),
  h4: ({ id, children }) => (
    <h4 id={id} className={cn(heading, underStuckHeading, "mt-6 mb-2 text-[1em]")}>
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-3 flex list-disc flex-col gap-1 pl-6 marker:text-muted-foreground/60">
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol
      start={start}
      className="my-3 flex list-decimal flex-col gap-1 pl-6 marker:text-muted-foreground/60"
    >
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ href, target, children }) => {
    const className = "font-medium text-primary underline underline-offset-2";
    // Another lesson, as `rehypeLesson` addressed it: a client-side move rather than a page load.
    if (href?.startsWith("/") && !href.startsWith("//")) {
      return (
        <Link href={href} className={className}>
          {children}
        </Link>
      );
    }
    return (
      <a href={href} target={target} rel={target ? "noreferrer" : undefined} className={className}>
        {children}
      </a>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ className, children, node }) => {
    const fence = /language-([\w-]+)/.exec(className ?? "");
    if (fence) {
      const language = languageForFence(fence[1]);
      if (language && node) {
        return (
          <HighlightedCode node={node} language={language} className={className}>
            {children}
          </HighlightedCode>
        );
      }
      return <code className={cn("font-mono text-[0.85em]", className)}>{children}</code>;
    }
    // A fence with no language reaches here too; inside `pre` it takes the block's own styling.
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] [pre_&]:bg-transparent [pre_&]:p-0">
        {children}
      </code>
    );
  },
  pre: ({ children, node }) => {
    const code = node?.children[0];
    const isMermaid =
      code?.type === "element" &&
      String(code.properties.className ?? "").includes("language-mermaid");
    if (isMermaid) return <MermaidDiagram source={textOf(code).replace(/\n$/, "")} />;

    return (
      <div data-code-block className="relative my-4">
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/60 p-3 pr-11 leading-relaxed">
          {children}
        </pre>
        <CopyButton text={code ? textOf(code).replace(/\n$/, "") : ""} />
      </div>
    );
  },
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[0.875em]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-border px-3 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-3 py-2 align-top [tr:last-child_&]:border-b-0">
      {children}
    </td>
  ),
  hr: () => <hr className="my-8 border-border" />,
  img: ({ src, alt, width }) => (
    // Plain `img` rather than `next/image`: the files are on GitHub at sizes nobody recorded, and
    // the optimizer would need the host configured and would serve each one through Vercel.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={typeof src === "string" ? src : undefined}
      alt={alt ?? ""}
      width={width}
      loading="lazy"
      className="my-4 inline-block h-auto max-w-full rounded-md border border-border"
    />
  ),
  kbd: ({ children }) => (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.8em]">
      {children}
    </kbd>
  ),
  details: ({ children, open }) => (
    <details
      open={open}
      className="group my-4 rounded-md border border-border px-4 py-2 [&>*:last-child]:mb-2"
    >
      {children}
    </details>
  ),
  summary: ({ children }) => (
    <summary className="-mx-4 -my-2 cursor-pointer px-4 py-2 font-medium group-open:mb-2 group-open:border-b group-open:border-border [&>p]:inline">
      {children}
    </summary>
  ),
  aside: ({ node, children }) => (
    <Callout tone={String(node?.properties.dataHint ?? "info")}>{children}</Callout>
  ),
  div: ({ node, children }) => {
    const title = node?.properties.dataCodeTitle;
    if (typeof title === "string") {
      return (
        <div className="my-4 overflow-hidden rounded-md border border-border [&_[data-code-block]]:my-0 [&_pre]:rounded-none [&_pre]:border-0">
          {title !== "" && (
            <div className="border-b border-border bg-muted px-3 py-1.5 font-mono text-[0.75em] text-muted-foreground">
              {title}
            </div>
          )}
          {children}
        </div>
      );
    }

    const embed = node?.properties.dataEmbed;
    if (typeof embed === "string") return <Embed url={embed} />;

    return <div>{children}</div>;
  },
};

const CALLOUTS: Record<string, { icon: React.ElementType; className: string }> = {
  info: {
    icon: Info,
    className: "border-sky-500/30 bg-sky-500/[0.06] [&>svg]:text-sky-600 dark:[&>svg]:text-sky-400",
  },
  warning: {
    icon: TriangleAlert,
    className:
      "border-amber-500/30 bg-amber-500/[0.07] [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400",
  },
  danger: {
    icon: OctagonAlert,
    className: "border-destructive/30 bg-destructive/[0.06] [&>svg]:text-destructive",
  },
  success: {
    icon: CircleCheck,
    className:
      "border-emerald-500/30 bg-emerald-500/[0.07] [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400",
  },
};

/**
 * Copies a code block's text, as written rather than as coloured, and shows a check mark for two
 * seconds so the reader knows it worked.
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy code"}
      title={copied ? "Copied" : "Copy code"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
      className="absolute top-2 right-2 rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground"
    >
      {copied ? (
        <Check aria-hidden className="size-3.5" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
    </button>
  );
}

/** GitBook's `{% hint %}`: a boxed note with an icon for its style. An unknown style is drawn as info. */
function Callout({ tone, children }: { tone: string; children: React.ReactNode }) {
  const callout = CALLOUTS[tone] ?? CALLOUTS.info;
  const Icon = callout.icon;

  return (
    <aside
      className={cn(
        "my-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-md border px-4 py-3",
        callout.className,
      )}
    >
      <Icon aria-hidden className="mt-1 size-4" />
      <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </aside>
  );
}

/**
 * GitBook's `{% embed %}`. A Google Docs, Sheets or Slides address becomes the same frame a
 * submitted document gets; anything else becomes a link.
 *
 * Closed rather than open, as every embed in this application is: a lesson can place a Google
 * document on the page but never an arbitrary site in a frame.
 */
function Embed({ url }: { url: string }) {
  const ref = parseDriveDocUrl(url);
  if (ref === null) {
    return (
      <p className="my-3">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline underline-offset-2"
        >
          {url}
        </a>
      </p>
    );
  }

  return (
    <iframe
      src={driveEmbedUrl(ref)}
      title={DRIVE_DOC_KIND_LABEL[ref.kind]}
      className="my-4 aspect-video w-full rounded-md border border-border"
      allow=""
      allowFullScreen
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

/**
 * A ```` ```mermaid ```` block, drawn as a diagram.
 *
 * Mermaid is about 500 KB, and two lessons of the 48 use it, so it is imported when one of these
 * mounts rather than with the page, the way `useFileHighlight` loads Shiki. Until it has drawn, and
 * for good if it cannot, the source is shown as a code block, which is still readable.
 *
 * `securityLevel: "strict"` makes Mermaid clean its own output and refuse clicks and HTML labels,
 * which is what allows the drawing to be placed in the page as markup.
 */
function MermaidDiagram({ source }: { source: string }) {
  const { resolvedTheme } = useTheme();
  // Mermaid uses the id as an element id while it measures; React's ids contain colons.
  const id = `mermaid-${React.useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const [svg, setSvg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: resolvedTheme === "dark" ? "dark" : "default",
        });
        const result = await mermaid.render(id, source);
        if (active) setSvg(result.svg);
      } catch {
        if (active) setSvg(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [id, source, resolvedTheme]);

  if (svg === null) {
    return (
      <pre className="my-4 overflow-x-auto rounded-md border border-border bg-muted/60 p-3 leading-relaxed">
        <code className="font-mono text-[0.85em]">{source}</code>
      </pre>
    );
  }

  return (
    <div
      className="my-4 flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
