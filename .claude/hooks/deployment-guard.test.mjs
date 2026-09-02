import { execFileSync } from "node:child_process";

const GUARD = new URL("deployment-guard.mjs", import.meta.url).pathname;

const cases = [
  [
    "a commit message describing the commands",
    "git commit -F - <<'EOF'\nUse npm run db:deploy:deployment, and --delete removes objects\nEOF",
    "allowed",
  ],
  [
    "a document describing them",
    "cat > NOTES.md <<'EOF'\nRun npm run setup:storage:deployment yourself.\nEOF",
    "allowed",
  ],
  [
    "the same words smuggled into bash",
    "bash <<'EOF'\nnpm run reconcile:uploads:deployment -- --delete\nEOF",
    "deny",
  ],
  ["the mistake I actually made", "npm run reconcile:uploads:deployment -- --delete", "deny"],
  ["a migration against the deployment", "npm run db:deploy:deployment", "deny"],
  ["the storage setup script", "npm run setup:storage:deployment", "deny"],
  [
    "a raw deleteMany through the wrapper",
    "npx tsx scripts/with-deployment-env.ts npx tsx x.ts # deleteMany",
    "deny",
  ],
  ["the reconciler's dry run", "npm run reconcile:uploads:deployment 2>&1 | tail -16", "allowed"],
  ["migration status", "npm run db:status:deployment", "allowed"],
  [
    "an ad-hoc read through the wrapper",
    "npx tsx scripts/with-deployment-env.ts npx tsx scripts/tmp-audit.ts",
    "ask",
  ],
  ["the same delete against development", "npm run reconcile:uploads -- --delete", "allowed"],
  ["an unrelated command", "npm test", "allowed"],
];

let failures = 0;

for (const [label, command, expected] of cases) {
  const out = execFileSync("node", [GUARD], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8",
  });

  const actual = out.trim() ? JSON.parse(out).hookSpecificOutput.permissionDecision : "allowed";
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label.padEnd(42)} ${actual}${ok ? "" : `  (expected ${expected})`}`,
  );
}

console.log(failures === 0 ? "\nAll cases decided correctly." : `\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
