"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";

/**
 * Copies a code block's text, as written rather than as coloured, and shows a check mark for two
 * seconds so the reader knows it worked. Drawn at the top right of the block it sits in.
 */
export function CopyButton({ text }: { text: string }) {
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
