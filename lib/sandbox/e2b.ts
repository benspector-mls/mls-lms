import "server-only";

import { CommandExitError, Sandbox } from "e2b";

import { RESULTS_DIR, TEMPLATE_DIR, WORK_DIR } from "./paths";

/**
 * The E2B sandbox mechanics: create, put files in, run commands, get results out,
 * destroy.
 *
 * Kept separate from run-tests.ts so that the sequence in which the network is
 * revoked is visible in one place and cannot be reordered by accident. Steps 3
 * and 4 of the run — install with network access, then revoke it before student
 * code executes — are the whole security design of this phase, and they are only
 * safe in that order.
 */

export { RESULTS_DIR, TEMPLATE_DIR, WORK_DIR };

export type CommandOutcome = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** True when the command was killed for exceeding its time limit. */
  timedOut: boolean;
};

/**
 * `timeout` exits with 124 when it kills the command. GNU coreutils has used this
 * value since it was introduced, and it is what distinguishes a student's infinite
 * loop from a test suite that merely failed.
 */
const TIMEOUT_EXIT_CODE = 124;

export function requireE2bApiKey(): string {
  const key = process.env.E2B_API_KEY;
  if (!key) {
    throw new Error(
      "E2B_API_KEY is not set. Create one at https://e2b.dev/dashboard and add it " +
      "to .env.local — see .env.example.",
    );
  }
  return key;
}

export type SandboxHandle = {
  sandbox: Sandbox;
  sandboxId: string;
};

/**
 * Creates a sandbox with internet access **enabled**, because the next thing that
 * happens is installing dependencies and that requires it.
 *
 * `timeoutMs` is the sandbox's own lifetime, deliberately longer than the test
 * command's limit so that the command's `timeout` is what stops a runaway suite.
 * If the sandbox expired first, a student's infinite loop would be indistinguishable
 * from an infrastructure failure.
 *
 * The environment is empty. Never pass process.env through: it holds the GitHub
 * installation token, which carries write access to every repository in the
 * organization, and the one process it would be exposed to is the process running
 * code written by a student.
 */
export async function createSandbox(opts: {
  template: string;
  lifetimeMs: number;
}): Promise<SandboxHandle> {
  const sandbox = await Sandbox.create(opts.template, {
    apiKey: requireE2bApiKey(),
    timeoutMs: opts.lifetimeMs,
    allowInternetAccess: true,
    envs: {},
  });
  return { sandbox, sandboxId: sandbox.sandboxId };
}

/**
 * Uploads a gzipped tar and extracts it.
 *
 * One upload rather than one call per file, which matters because an assignment
 * repository can hold hundreds of files. GitHub's tarballs wrap everything in a
 * single top-level directory with a generated name, so `--strip-components=1`
 * lands the contents directly in `destDir`.
 */
export async function uploadAndExtract(
  handle: SandboxHandle,
  params: { tarball: Buffer; destDir: string },
): Promise<void> {
  const archivePath = `/tmp/${params.destDir.replace(/\W/g, "_")}.tar.gz`;

  // Buffer is a Uint8Array view, which may be a window onto a larger pool, so the
  // range has to be sliced out rather than handing over the whole backing buffer.
  const { buffer, byteOffset, byteLength } = params.tarball;
  const bytes = buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;

  await handle.sandbox.files.write(archivePath, bytes);

  const extract = await runCommand(handle, {
    command:
      `mkdir -p ${params.destDir} && ` +
      `tar xzf ${archivePath} -C ${params.destDir} --strip-components=1 && ` +
      `rm -f ${archivePath}`,
    timeoutMs: 60_000,
  });

  if (extract.exitCode !== 0) {
    throw new Error(
      `Could not extract the archive into ${params.destDir} ` +
      `(exit ${extract.exitCode}): ${extract.stderr.slice(0, 500)}`,
    );
  }
}

/**
 * Runs a command and returns its outcome rather than throwing on a non-zero exit.
 *
 * A failing test suite exits non-zero, and that is an ordinary result rather than
 * an error, so the SDK's CommandExitError is converted into a value. Distinguishing
 * "the suite ran and tests failed" from "the suite could not run" is the whole
 * point of this phase, and an exception collapses the two.
 *
 * The time limit is applied with `timeout` inside the sandbox rather than by
 * aborting the request, so the limit is enforced where the process actually runs
 * and produces a documented exit code.
 */
export async function runCommand(
  handle: SandboxHandle,
  params: {
    command: string;
    cwd?: string;
    timeoutMs: number;
    /** Passed to the command only. Never includes anything from process.env. */
    envs?: Record<string, string>;
  },
): Promise<CommandOutcome> {
  const seconds = Math.max(1, Math.ceil(params.timeoutMs / 1000));
  // --kill-after sends SIGKILL if the process ignores the initial SIGTERM, which a
  // suite trapping signals otherwise survives.
  const guarded = `timeout --kill-after=10s ${seconds}s sh -c ${shellQuote(params.command)}`;

  const startedAt = Date.now();
  try {
    const result = await handle.sandbox.commands.run(guarded, {
      ...(params.cwd ? { cwd: params.cwd } : {}),
      envs: params.envs ?? {},
      // Generous, because this is the HTTP request's patience rather than the
      // command's. The command's own limit is `timeout` above.
      requestTimeoutMs: params.timeoutMs + 60_000,
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
      timedOut: result.exitCode === TIMEOUT_EXIT_CODE,
    };
  } catch (err) {
    if (err instanceof CommandExitError) {
      return {
        exitCode: err.exitCode,
        stdout: err.stdout,
        stderr: err.stderr,
        durationMs: Date.now() - startedAt,
        timedOut: err.exitCode === TIMEOUT_EXIT_CODE,
      };
    }
    throw err;
  }
}

/**
 * Revokes internet access on a running sandbox.
 *
 * This is what makes install-then-revoke possible rather than having to choose one
 * setting for the whole run. It buys two things. Results become reproducible,
 * because a test that reaches an outside service returns a different answer when
 * that service is slow or unavailable, and a grade that changes without the code
 * changing is not a grade. And student code loses its channel to the outside world
 * for exactly the part of the run where student code is what executes.
 *
 * Called before the test command and after setup. Verified against e2b 2.37.0.
 */
export async function revokeNetworkAccess(handle: SandboxHandle): Promise<void> {
  await handle.sandbox.updateNetwork({ allowInternetAccess: false });
}

/** Returns null when the file does not exist, which a crashed suite produces. */
export async function readTextFile(
  handle: SandboxHandle,
  path: string,
): Promise<string | null> {
  try {
    return await handle.sandbox.files.read(path, { format: "text" });
  } catch {
    return null;
  }
}

/**
 * Destroys the sandbox. Always call this in a `finally` block: a leaked sandbox
 * bills until its own lifetime expires.
 *
 * Never throws. A failure to kill must not mask the error that is already being
 * handled, and the sandbox expires on its own regardless.
 */
export async function killSandbox(handle: SandboxHandle): Promise<void> {
  try {
    await handle.sandbox.kill();
  } catch (err) {
    console.error(`Could not kill sandbox ${handle.sandboxId}:`, err);
  }
}

/**
 * Wraps a string as a single-quoted shell word.
 *
 * Every command run here is composed from preset configuration rather than from
 * student input, so this is a second line of defence rather than the only one. It
 * exists because a preset's testCommand is a plain string in a config file, and a
 * stray quote in one would otherwise change what the shell executes.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
