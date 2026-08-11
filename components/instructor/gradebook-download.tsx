"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { gradebookCsvFilename } from "@/lib/gradebook/csv";

/**
 * Hands over the gradebook as a spreadsheet.
 *
 * **The file arrives already built.** `gradebookCsv` runs in the same server render that drew the
 * grid, and this takes the finished string as a prop — so there is no second query, no endpoint to
 * gate a second time, and no way for the file to describe a different set of students than the
 * table above it. Passing the payload instead and assembling it here would serialize a term's worth
 * of grading cells into the page for everybody, including the majority who never press this.
 *
 * The date in the filename is read at the moment of the press rather than at render, so a download
 * taken late in the evening is stamped with the reader's day rather than the server's, which is
 * already tomorrow in UTC.
 */
export function GradebookDownload({
  csv,
  cohortTerm,
  groupLabel,
}: {
  csv: string;
  cohortTerm: string;
  /** Null when the whole cohort is on screen. */
  groupLabel: string | null;
}) {
  function download() {
    /*
      The byte order mark is what makes Excel read this as UTF-8. Without it, it falls back to the
      system code page and a name with an accent in it arrives mangled — on the one screen whose
      entire job is to name people correctly.
    */
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    /*
      A real anchor in the document, rather than a detached one or a navigation. `download` is what
      saves the file instead of opening it, and the attribute is only honoured on an element that is
      in the document — a detached anchor navigates away in Safari. Revoking on a timeout for the
      same reason: the browser reads the blob after the click returns.
    */
    const link = document.createElement("a");
    link.href = url;
    link.download = gradebookCsvFilename({ cohortTerm, groupLabel, date: new Date() });
    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <Button variant="outline" onClick={download}>
      <Download data-icon="inline-start" />
      Download CSV
    </Button>
  );
}
