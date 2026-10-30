/**
 * Builds the E2B template the Python runner uses.
 *
 *   npm run template:build            # Python 3.14
 *   npm run template:build -- 3.12    # another version
 *
 * E2B's stock "base" template decides which Python it carries, and nothing in this
 * repository can change that. The Python preset therefore names a template of our
 * own, `PYTHON_TEMPLATE` in lib/sandbox/presets.ts, and this script is what creates
 * it. The template starts from the official Debian-based `python:<version>` image,
 * which carries the coreutils `timeout` and `tar` the sandbox mechanics rely on,
 * and has pytest and the JSON report plugin installed so the preset's setup command
 * finds them already present.
 *
 * Rebuilding with a different version replaces the template under the same name,
 * so moving from one Python to another is one run of this script and no code
 * change. The build runs against the E2B account whose key is in `.env.local`.
 */
import { Template, defaultBuildLogger } from "e2b";

import { PYTHON_TEMPLATE } from "../lib/sandbox/presets";
import { loadEnvironment } from "./verify/harness";

loadEnvironment();

const DEFAULT_PYTHON_VERSION = "3.14";

/** Python packages installed into the template, so setup never downloads them. */
const PREINSTALLED = ["pytest", "pytest-json-report"];

async function main() {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY is not set. Add it to .env.local — see .env.example.");
  }

  const version = process.argv[2] ?? DEFAULT_PYTHON_VERSION;
  if (!/^3\.\d{1,2}$/.test(version)) {
    throw new Error(`"${version}" is not a Python version such as 3.14.`);
  }

  console.log(`Building template "${PYTHON_TEMPLATE}" from python:${version}\n`);

  const template = Template().fromPythonImage(version).pipInstall(PREINSTALLED);

  const built = await Template.build(template, PYTHON_TEMPLATE, {
    onBuildLogs: defaultBuildLogger(),
  });

  console.log(`\nBuilt ${built.name} (template ${built.templateId}, build ${built.buildId}).`);
  console.log(
    `Every python-pytest run now uses Python ${version}. ` +
      `Run one real submission with \`npm run tests:run\` to confirm the suite still reports.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
