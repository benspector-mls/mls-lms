"use client";

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Play, RotateCcw, Square, X } from "lucide-react";
import * as React from "react";

import { CodeEditor } from "@/components/lesson/code-editor";
import { EARLIER_CODE } from "@/components/lesson/runnable-block";
import { Button } from "@/components/ui/button";
import { type FromWorker, PYTHON_WORKER_SOURCE, type ToWorker } from "@/lib/lessons/python-worker";

type RunState = "running" | "waiting" | "idle";

/**
 * A Python block being run: its code in an editor, a terminal beneath it for what the program
 * prints and for what the fellow types at `input()`, and Run, Stop, Reset and Close.
 *
 * **The program runs in a Web Worker**, built from `PYTHON_WORKER_SOURCE`, so the page stays
 * responsive while it runs and an endless loop is ended by Stop, which throws the worker away;
 * the next Run starts a fresh one, which loads Python again from the browser's cache. The first
 * run on a machine waits for the six-megabyte download, so the terminal says so.
 *
 * **The terminal is a line editor.** Typed characters are shown and kept until Enter sends the
 * line to the worker, where a waiting `input()` takes it; Backspace removes the last character.
 * A line typed before the program asks for one is kept for its next `input()`. What the program
 * prints arrives as the worker writes it, so a prompt with no newline is shown before the fellow
 * types.
 *
 * **A hidden setup runs first.** A block that builds on code shown earlier in the lesson names a
 * setup, which the worker runs in the same interpreter before the block, so the block's own
 * lines are what the fellow edits and gets tracebacks for. The setup is shown above them in the
 * editor, folded and read-only, so a fellow can see what ran before their lines.
 *
 * Nothing the fellow runs or types is stored or sent to the server.
 */
export function PythonRunner({
  code: original,
  setup,
  setupMissing,
  onClose,
}: {
  code: string;
  /** The Python to run before the block, from the setups it names. */
  setup?: string;
  /** Setups the block names that the page does not define, to say so before running. */
  setupMissing?: string;
  /** Called by Close; the block that mounted the runner takes it down, which ends the worker. */
  onClose: () => void;
}) {
  const [code, setCode] = React.useState(original);
  const [state, setState] = React.useState<RunState>("running");
  const host = React.useRef<HTMLDivElement>(null);
  const terminal = React.useRef<Terminal | null>(null);
  const worker = React.useRef<Worker | null>(null);
  /** The address the worker's script is served from, kept until the worker is gone. */
  const workerUrl = React.useRef<string | null>(null);
  const line = React.useRef("");
  const codeRef = React.useRef(code);
  codeRef.current = code;

  /*
    The script's address is kept until here: a module worker fetches its script after it is
    made, and an address revoked in the meantime has been seen to fail that fetch in Safari.
  */
  const endWorker = () => {
    worker.current?.terminate();
    worker.current = null;
    if (workerUrl.current) URL.revokeObjectURL(workerUrl.current);
    workerUrl.current = null;
  };

  const startWorker = React.useCallback(() => {
    const url = URL.createObjectURL(new Blob([PYTHON_WORKER_SOURCE], { type: "text/javascript" }));
    const started = new Worker(url, { type: "module" });
    started.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      const term = terminal.current;
      if (message.type === "stdout") term?.write(message.text);
      else if (message.type === "stderr") term?.write(`\x1b[31m${message.text}\x1b[0m`);
      else if (message.type === "input") {
        setState("waiting");
        term?.focus();
      } else if (message.type === "done") setState("idle");
      else if (message.type === "failed") {
        term?.write(`\x1b[31mPython could not be loaded: ${message.message}\x1b[0m\r\n`);
        setState("idle");
      }
    };
    started.onerror = (event) => {
      // A worker that failed to start answers nothing; the next Run makes a new one. A module
      // worker whose script could not be fetched or parsed reports an event with no message.
      const message = event.message || "The Python runner could not be started.";
      terminal.current?.write(`\x1b[31m${message}\x1b[0m\r\n`);
      endWorker();
      setState("idle");
    };
    worker.current = started;
    workerUrl.current = url;
    return started;
  }, []);

  const run = React.useCallback(() => {
    const term = terminal.current;
    term?.reset();
    line.current = "";
    const current = worker.current ?? startWorker();
    setState("running");
    if (setupMissing) {
      // For whoever wrote the lesson: the block will most likely fail with a NameError.
      term?.write(
        `\x1b[33mThis block names a setup the lesson does not define: ${setupMissing}.\x1b[0m\r\n`,
      );
    }
    const message: ToWorker = { type: "run", code: codeRef.current, setup };
    current.postMessage(message);
  }, [setup, setupMissing, startWorker]);

  const stop = () => {
    endWorker();
    terminal.current?.write("\r\n\x1b[33mStopped.\x1b[0m\r\n");
    setState("idle");
  };

  React.useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({ convertEol: true, cursorBlink: true, fontSize: 13, rows: 12 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    term.onData((data) => {
      // Enter arrives as "\r"; a paste may hold "\n" or "\r\n" between its lines.
      let previous = "";
      for (const character of data) {
        const skipped = character === "\n" && previous === "\r";
        previous = character;
        if (skipped) continue;
        if (character === "\r" || character === "\n") {
          term.write("\r\n");
          const message: ToWorker = { type: "stdin", line: line.current };
          worker.current?.postMessage(message);
          line.current = "";
          setState((current) => (current === "waiting" ? "running" : current));
        } else if (character === "\x7f") {
          if (line.current.length > 0) {
            line.current = line.current.slice(0, -1);
            term.write("\b \b");
          }
        } else if (character >= " ") {
          line.current += character;
          term.write(character);
        }
      }
    });
    terminal.current = term;
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host.current);

    term.write("\x1b[2mLoading Python…\x1b[0m\r\n");
    run();

    return () => {
      observer.disconnect();
      endWorker();
      term.dispose();
      terminal.current = null;
    };
  }, [run]);

  const busy = state !== "idle";

  return (
    <div className="my-4 flex flex-col gap-2">
      <CodeEditor
        value={code}
        onChange={setCode}
        language="python"
        ariaLabel="Python code"
        prelude={setup === undefined ? undefined : { code: setup, label: EARLIER_CODE }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {busy ? (
          <Button type="button" variant="outline" size="xs" onClick={stop}>
            <Square aria-hidden data-icon="inline-start" />
            Stop
          </Button>
        ) : (
          <Button type="button" variant="outline" size="xs" onClick={run}>
            <Play aria-hidden data-icon="inline-start" />
            Run
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setCode(original)}
          disabled={code === original}
        >
          <RotateCcw aria-hidden data-icon="inline-start" />
          Reset
        </Button>
        <span className="text-xs text-muted-foreground">
          {state === "waiting"
            ? "Waiting for you to type a line and press Enter."
            : state === "running"
              ? "Running…"
              : "Finished."}
        </span>
        <Button type="button" variant="ghost" size="xs" className="ml-auto" onClick={onClose}>
          <X aria-hidden data-icon="inline-start" />
          Close
        </Button>
      </div>
      <div ref={host} className="overflow-hidden rounded-md border border-border p-1" />
    </div>
  );
}
