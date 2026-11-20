// Converts FEATURES.md into training/guide.html, the page published for the programs team.
// FEATURES.md is the source. Edit FEATURES.md, run `node training/build-guide.mjs`, then republish
// training/guide.html. Never edit guide.html by hand, because the next run overwrites it.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { marked } from "marked";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "FEATURES.md"), "utf8");

/** The anchor GitHub gives a heading, which is what the links inside FEATURES.md already point at. */
function slug(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/ /g, "-");
}

let html = marked.parse(source, { gfm: true });

// The page's own header carries the title, so the document's first heading is dropped.
html = html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, "");

const sections = [];
html = html.replace(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/g, (_match, level, inner) => {
  const id = slug(inner);
  const title = inner.replace(/<[^>]+>/g, "");
  if (level === "2") sections.push({ id, title, tasks: [] });
  else if (sections.length > 0) sections[sections.length - 1].tasks.push({ id, title });
  return `<h${level} id="${id}">${inner}</h${level}>`;
});

// A wide table scrolls inside its own box, so the page itself never scrolls sideways.
html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");

// Links to other files in the repository lead nowhere from the published page, so they become text.
html = html.replace(/<a href="[^"#]+\.md[^"]*">([\s\S]*?)<\/a>/g, "$1");

const contents = sections
  .map((section) => {
    const tasks = section.tasks
      .map((task) => `<li><a href="#${task.id}">${task.title}</a></li>`)
      .join("");
    return `<li><a class="group" href="#${section.id}">${section.title}</a>${tasks ? `<ul>${tasks}</ul>` : ""}</li>`;
  })
  .join("");

const page = `<title>Marcy LMS Guide</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600&display=swap">
<style>
  /* Layout: a list of tasks fixed at the left, one readable column of the guide at the right. */
  :root {
    --bg: #f6f8fb;
    --surface: #ffffff;
    --ink: #17202e;
    --muted: #5a6779;
    --line: #dbe1ea;
    --accent: #1f5fbf;
    --accent-soft: #e6eefb;
    --font-display: "Space Grotesk", "Segoe UI", system-ui, sans-serif;
    --font-body: Inter, "Segoe UI", system-ui, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #10151d; --surface: #171e29; --ink: #e6ebf2; --muted: #9aa7b8; --line: #2a3443;
      --accent: #7fb0f5; --accent-soft: #1c2a40; color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --bg: #10151d; --surface: #171e29; --ink: #e6ebf2; --muted: #9aa7b8; --line: #2a3443;
    --accent: #7fb0f5; --accent-soft: #1c2a40; color-scheme: dark;
  }
  body { background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 16px; line-height: 1.6; }
  .page {
    display: grid; grid-template-columns: 17rem minmax(0, 1fr); gap: 2.5rem; max-width: 76rem; margin: 0 auto;
    padding-block: 2rem 4rem;
    padding-left: max(16px, env(safe-area-inset-left, 0px));
    padding-right: max(16px, env(safe-area-inset-right, 0px));
  }
  nav.contents { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 1rem); align-self: start; max-height: calc(100vh - 2rem); overflow-y: auto; font-size: 0.875rem; }
  nav.contents summary { font-family: var(--font-display); font-weight: 600; cursor: pointer; padding: 0.25rem 0; }
  nav.contents ul { list-style: none; margin: 0; padding: 0; }
  nav.contents > details > ul > li { margin-top: 0.9rem; }
  nav.contents a { display: block; padding: 0.2rem 0.5rem; border-radius: 4px; color: var(--muted); text-decoration: none; }
  nav.contents a.group { color: var(--ink); font-weight: 600; }
  nav.contents a:hover, nav.contents a:focus-visible { background: var(--accent-soft); color: var(--accent); outline: none; }
  main { min-width: 0; max-width: 46rem; }
  header.top h1 { font-family: var(--font-display); font-size: 2.25rem; line-height: 1.15; margin: 0 0 0.5rem; text-wrap: balance; }
  header.top p { color: var(--muted); margin: 0 0 1.5rem; }
  main h2 { font-family: var(--font-display); font-size: 1.6rem; line-height: 1.2; margin: 3rem 0 0.75rem; padding-top: 1.5rem; border-top: 2px solid var(--ink); text-wrap: balance; }
  main h3 { font-family: var(--font-display); font-size: 1.2rem; line-height: 1.3; margin: 2.25rem 0 0.5rem; color: var(--accent); text-wrap: balance; }
  main h2, main h3 { scroll-margin-top: calc(env(safe-area-inset-top, 0px) + 1rem); }
  main p, main li { overflow-wrap: anywhere; }
  main a { color: var(--accent); }
  main hr { border: 0; margin: 0; }
  main code { font-size: 0.9em; background: var(--accent-soft); padding: 0.1em 0.3em; border-radius: 3px; }
  .table-wrap { overflow-x: auto; margin: 1rem 0; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { text-align: left; vertical-align: top; padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--line); min-width: 9rem; }
  th { font-weight: 600; color: var(--muted); }
  tr:last-child td { border-bottom: 0; }
  @media (max-width: 60rem) {
    .page { grid-template-columns: minmax(0, 1fr); gap: 1rem; }
    nav.contents { position: static; max-height: none; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); padding: 0.5rem 0.75rem; }
  }
</style>
<div class="page">
  <nav class="contents" aria-label="Tasks in this guide">
    <details id="contents-list" open>
      <summary>Tasks in this guide</summary>
      <ul>${contents}</ul>
    </details>
  </nav>
  <main>
    <header class="top">
      <h1>Marcy LMS Guide</h1>
      <p>What admins, instructors and fellows can do in the LMS, one task at a time.</p>
    </header>
    ${html}
  </main>
</div>
<script>
  // On a phone the list of tasks starts closed, so the guide itself is the first thing on screen.
  if (window.matchMedia("(max-width: 60rem)").matches) document.getElementById("contents-list").open = false;
</script>
`;

writeFileSync(join(here, "guide.html"), page);
console.log(`Wrote training/guide.html with ${sections.length} sections.`);
