/**
 * Checks the sandbox properties that only a real sandbox can demonstrate.
 *
 *   npm run verify:e2b
 *
 * Costs a few sandbox-minutes and touches no student repository, which is the
 * point: these are properties of the runner, not of any submission. What it proves:
 *
 *   1. Nothing from process.env reaches the sandbox — above all the GitHub
 *      installation token, which carries write access to every repository in the
 *      organization.
 *   2. The network works before it is revoked and does not work afterward.
 *   3. A command that never terminates is killed and is reported as a timeout
 *      rather than as an infrastructure failure.
 *   4. No sandbox survives the run. A leaked sandbox bills until its own lifetime
 *      expires.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

let failures = 0;
function check(label: string, pass: boolean, detail = "") {
  if (pass) console.log(`ok   ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? `\n  ${detail}` : ""}`);
  }
}

async function main() {
  const { createSandbox, killSandbox, revokeNetworkAccess, runCommand } =
    await import("../lib/sandbox/e2b");
  const { Sandbox } = await import("e2b");

  // Set here so the probe can prove these specific names do not appear inside.
  // The real ones are already in process.env; these make the check meaningful even
  // if a name is missing locally.
  process.env.CANARY_SECRET = "canary-must-not-appear-in-sandbox";

  const handle = await createSandbox({ template: "base", lifetimeMs: 120_000 });
  console.log(`Sandbox ${handle.sandboxId}\n`);

  try {
    // ---- 1. Environment isolation ----------------------------------------
    const env = await runCommand(handle, { command: "env", timeoutMs: 15_000 });
    const leaked = [
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_ID",
      "GITHUB_WEBHOOK_SECRET",
      "GITHUB_APP_INSTALLATION_ID",
      "E2B_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "DATABASE_URL",
      "DIRECT_URL",
      "GROQ_API_KEY",
      "CANARY_SECRET",
    ].filter((name) => env.stdout.includes(`${name}=`));

    check(
      "no credential env vars reach the sandbox",
      leaked.length === 0,
      `leaked: ${leaked.join(", ")}`,
    );
    check(
      "the canary value itself is absent",
      !env.stdout.includes("canary-must-not-appear-in-sandbox"),
    );

    // ---- 2. Network before and after revocation --------------------------
    const probe =
      `node -e "fetch('https://registry.npmjs.org/-/ping',{signal:AbortSignal.timeout(8000)})` +
      `.then(r=>{console.log('REACHED',r.status);process.exit(0)})` +
      `.catch(e=>{console.log('BLOCKED',e.name);process.exit(3)})"`;

    const before = await runCommand(handle, { command: probe, timeoutMs: 30_000 });
    check(
      "the network is reachable before revocation",
      before.stdout.includes("REACHED"),
      `exit ${before.exitCode}: ${before.stdout.trim() || before.stderr.trim()}`,
    );

    await revokeNetworkAccess(handle);

    const after = await runCommand(handle, { command: probe, timeoutMs: 30_000 });
    check(
      "the network is blocked after revocation",
      after.stdout.includes("BLOCKED") || after.exitCode !== 0,
      `exit ${after.exitCode}: ${after.stdout.trim() || after.stderr.trim()}`,
    );

    // ---- 3. A command that never ends ------------------------------------
    const spin = await runCommand(handle, {
      command: "while true; do :; done",
      timeoutMs: 5_000,
    });
    check(
      "an endless command is killed",
      spin.timedOut,
      `exitCode ${spin.exitCode}, timedOut ${spin.timedOut}`,
    );
    check("the kill is reported as exit 124", spin.exitCode === 124, `exitCode ${spin.exitCode}`);
    check(
      "the sandbox still responds after a killed command",
      (await runCommand(handle, { command: "echo alive", timeoutMs: 15_000 })).stdout.includes(
        "alive",
      ),
    );
  } finally {
    await killSandbox(handle);
  }

  // ---- 4. Nothing left running -------------------------------------------
  const running: string[] = [];
  const paginator = Sandbox.list({ apiKey: process.env.E2B_API_KEY! });
  while (paginator.hasNext) {
    for (const item of await paginator.nextItems()) running.push(item.sandboxId);
  }
  check(
    "no sandbox is left running",
    running.length === 0,
    running.length ? `still running: ${running.join(", ")}` : "",
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
