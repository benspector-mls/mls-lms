#!/usr/bin/env node
/**
 * Stops Claude Code writing to the deployment's Supabase project.
 *
 * Two databases serve this application and `scripts/with-deployment-env.ts` is the only way to
 * reach the deployment's. Everything that goes through it — every `:deployment` npm script —
 * acts on real grades, real submissions, and a storage bucket with no undelete. Reading them is
 * useful and happens often; writing to them is a decision a person makes, not an assistant.
 *
 * **Why a hook rather than a permission rule.** `.claude/settings.local.json` allows
 * `Bash(npm run *)`, so every deployment command was pre-approved and none of them prompted.
 * A deny rule could name the always-destructive scripts, and does — see `.claude/settings.json`
 * — but the dangerous ones here are dangerous only with a flag: `reconcile:uploads:deployment`
 * reports what it would remove and `reconcile:uploads:deployment -- --delete` removes it. That
 * is a distinction a glob cannot draw and a program can.
 *
 * Three answers, and the default is the cautious one:
 *
 *   - a command that does not touch the deployment is none of this hook's business
 *   - a named read-only command, carrying nothing destructive, runs
 *   - a destructive marker is refused outright, with a message saying to run it by hand
 *   - anything else touching the deployment asks, so a person sees it before it runs
 *
 * This is a guardrail and not a wall, and it is worth being honest about which. Claude can edit
 * this file, so it stops mistakes rather than intentions. The boundary that does not depend on
 * anybody's good behaviour is a read-only Postgres role in `.env.deployment.local`, which
 * Postgres enforces and no amount of editing here can undo.
 */

const TOUCHES_DEPLOYMENT = /:deployment\b|with-deployment-env|\.env\.deployment/;

/**
 * Interpreters, which run a heredoc rather than reading it.
 *
 * The difference decides whether the text below a `<<EOF` is a command or a document. `git commit
 * -F -` takes a message; `bash <<EOF` takes instructions. Only the second can reach the
 * deployment from inside a heredoc, so only the second keeps its body when this looks.
 */
const INTERPRETER = /\b(bash|sh|zsh|fish|node|python3?|npx|tsx|eval|xargs|ssh)\b/;

/**
 * The command with any document-style heredoc body removed.
 *
 * Written because this hook refused a `git commit` whose *message* described the commands it
 * blocks. A commit message, a file written with `cat >`, a document explaining the rule — all of
 * them name `db:deploy:deployment` as text, and refusing to let anybody write that sentence is a
 * guard that punishes describing it. The body is kept whenever an interpreter would execute it,
 * so nothing can be smuggled past by wrapping it in a heredoc.
 */
function withoutDocumentHeredocs(command) {
  return command.replace(
    /(^|\n)([^\n]*?)<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\n[\s\S]*?\n\3\b/g,
    (whole, start, before, _marker) => (INTERPRETER.test(before) ? whole : `${start}${before}`),
  );
}

/** Commands that only read, named in full. Anything not on this list is not assumed safe. */
const READ_ONLY = ["npm run db:status:deployment", "npm run reconcile:uploads:deployment"];

/**
 * Words that make a command a write, whatever else it says.
 *
 * Deliberately broad, because the cost of a false positive is one prompt and the cost of a false
 * negative is rows or objects that are not coming back. `--delete` is here because it is the flag
 * that turns the reconciler from a report into a removal.
 */
const DESTRUCTIVE =
  /--delete|--force|\bdb:deploy\b|\bsetup:storage\b|\bmigrate\b|\bdeleteMany\b|\bupdateMany\b|\bdrop\b|\btruncate\b|\bremove\b|\bupsert\b|\binsert\b|\bupdate\b|\bcreate\b/i;

function decide(permissionDecision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let command = "";

  try {
    command = JSON.parse(raw)?.tool_input?.command ?? "";
  } catch {
    // A payload this cannot read is not a reason to block every command in the session.
    process.exit(0);
  }

  command = withoutDocumentHeredocs(command);

  if (!TOUCHES_DEPLOYMENT.test(command)) process.exit(0);

  const destructive = DESTRUCTIVE.test(command);
  const named = READ_ONLY.some((prefix) => command.trim().startsWith(prefix));

  if (named && !destructive) process.exit(0);

  if (destructive) {
    decide(
      "deny",
      "This writes to the deployment's Supabase project, which holds real grades and " +
        "submissions, and its storage bucket has no undelete. Claude Code does not run these. " +
        "Tell Ben what needs running and let him run it himself.",
    );
  }

  decide(
    "ask",
    "This acts on the deployment's Supabase project rather than the development one. Read it " +
      "before approving — the deployment holds real student work.",
  );
});
