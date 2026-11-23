import { Script } from "node:vm";

import { PYTHON_WORKER_SOURCE } from "@/lib/lessons/python-worker";

/**
 * The worker's script is the text of a template literal, so an escape that was meant for the
 * worker, such as a newline inside a string, can be eaten when the text is built and leave a
 * script that does not parse. A browser then starts no worker and reports an event with no
 * message, which says nothing about the cause; this test says it here instead.
 */
describe("PYTHON_WORKER_SOURCE", () => {
  it("is JavaScript that parses", () => {
    // `vm.Script` parses a classic script, so the one module-only line, the import, is replaced.
    const classic = PYTHON_WORKER_SOURCE.replace(/^import .*$/m, "const loadPyodide = null;");
    expect(() => new Script(classic)).not.toThrow();
  });

  it("escapes the newline that splits a traceback into lines", () => {
    expect(PYTHON_WORKER_SOURCE).toContain('message.split("\\n")');
  });
});
