/**
 * The Web Worker a lesson's Python block runs in, as the text of its script.
 *
 * **Why a string.** The worker is made from a Blob of this text rather than from a file the
 * bundler knows about, so it needs nothing from the bundler: no worker loader, no separate entry,
 * no path that changes between development and the deployment. The script's only import is
 * Pyodide, Python built for the browser, which the worker loads from jsDelivr: about six
 * megabytes on the first run and then from the browser's cache. Pyodide needs a module worker,
 * because its own file is an ES module.
 *
 * **How `input()` waits.** A terminal program stops at `input()` until a line is typed, and
 * Python in a worker can stop like that only with JS Promise Integration, which lets Python wait
 * on a JavaScript promise: here, the next line typed into the terminal, sent by the page. The
 * worker replaces the built-in `input` with one that writes the prompt, then waits on that
 * promise through Pyodide's `run_sync`, which works because every program is run through
 * `runPythonAsync`. Whether waiting is possible is asked inside `input()` itself, since the answer
 * depends on where the asking code runs; a browser without the integration runs the program all
 * the same and raises a plain error at the first `input()`, so a program that prints still
 * prints there.
 *
 * **What goes back and forth** is below as `ToWorker` and `FromWorker`. Each program runs with
 * a fresh set of global names holding only `__name__`, set to `"__main__"` as it is for a script,
 * so a variable from one run is not there in the next and a block guarded by
 * `if __name__ == "__main__":` runs its guarded part. A run may bring a setup, the hidden code
 * the lesson's block builds on, which runs in those same globals first; a failure in it is
 * reported as the setup's rather than the block's. The worker is thrown away by the page when a
 * program is stopped, which is how an endless loop ends.
 */

export const PYODIDE_VERSION = "314.0.8";
export const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`;

/** What the page sends the worker. */
export type ToWorker =
  | { type: "run"; code: string; setup?: string }
  | { type: "stdin"; line: string };

/** What the worker sends the page. */
export type FromWorker =
  | { type: "ready" }
  | { type: "stdout"; text: string }
  | { type: "stderr"; text: string }
  | { type: "input" }
  | { type: "done" }
  | { type: "failed"; message: string };

export const PYTHON_WORKER_SOURCE = `
import { loadPyodide } from "${PYODIDE_URL}";

const lines = [];
let waiting = null;

self.readLine = () =>
  new Promise((resolve) => {
    if (lines.length > 0) {
      resolve(lines.shift());
    } else {
      // Told only when the program is in fact waiting; a line typed ahead is taken at once.
      postMessage({ type: "input" });
      waiting = resolve;
    }
  });

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === "stdin") {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(message.line);
    } else {
      lines.push(message.line);
    }
  } else if (message.type === "run") {
    run(message.code, message.setup);
  }
};

const SETUP = \`
import builtins
import sys
from js import readLine
from pyodide.ffi import run_sync
try:
    from pyodide.ffi import can_run_sync
except ImportError:
    def can_run_sync():
        return False

def _input(prompt=""):
    sys.stdout.write(str(prompt))
    sys.stdout.flush()
    # Asked here, inside the program, which runs where waiting is possible; asked at setup it
    # would always say no, since setup runs where it is not.
    if not can_run_sync():
        raise RuntimeError("This browser cannot run input() here yet. Update it to the latest version.")
    return run_sync(readLine())

builtins.input = _input
\`;

const writer = (type) => {
  const decoder = new TextDecoder();
  return (buffer) => {
    postMessage({ type, text: decoder.decode(buffer, { stream: true }) });
    return buffer.length;
  };
};

const ready = (async () => {
  const pyodide = await loadPyodide();
  pyodide.setStdout({ write: writer("stdout"), isatty: true });
  pyodide.setStderr({ write: writer("stderr"), isatty: true });
  pyodide.runPython(SETUP);
  postMessage({ type: "ready" });
  return pyodide;
})();

/** An error as words, whatever was thrown: a Python traceback, a JavaScript error, or a bare value. */
function describe(err) {
  if (err instanceof Error) return err.message || err.stack || err.name;
  if (err === undefined || err === null) return "An error with no message (" + String(err) + ")";
  return String(err);
}

/*
  The traceback from the program's own lines down. Pyodide's message starts with the frames of
  its runner, in files a fellow has never seen, which say nothing about the program. The newline
  is written escaped because this text is a template literal: a plain one would be a real line
  break inside the worker's string, which does not parse.
*/
function programTraceback(message) {
  const lines = message.split("\\n");
  const first = lines.findIndex((line) => line.includes('File "<exec>"'));
  if (first <= 0) return message;
  return ["Traceback (most recent call last):", ...lines.slice(first)].join("\\n");
}

async function run(code, setup) {
  let pyodide;
  try {
    pyodide = await ready;
  } catch (err) {
    postMessage({ type: "failed", message: String((err && err.message) || err) });
    return;
  }
  lines.length = 0;
  // Named as a script is, so a block guarded by \`if __name__ == "__main__":\` runs its guarded part.
  const globals = pyodide.runPython('{"__name__": "__main__"}');
  try {
    if (setup) {
      try {
        await pyodide.runPythonAsync(setup, { globals });
      } catch (err) {
        console.error("The lesson's Python runner, in a hidden setup:", err);
        postMessage({
          type: "stderr",
          text: "In this block's hidden setup:\\n" + programTraceback(describe(err)),
        });
        return;
      }
    }
    await pyodide.runPythonAsync(code, { globals });
  } catch (err) {
    // The whole error to the browser's console, for whoever is looking into a failure.
    console.error("The lesson's Python runner:", err);
    postMessage({ type: "stderr", text: programTraceback(describe(err)) });
  } finally {
    globals.destroy();
    postMessage({ type: "done" });
  }
}
`;
