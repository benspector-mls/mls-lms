"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { coachingCsvFilename } from "@/lib/coaching/csv";

/**
 * Hands over one fellow's coaching history as a spreadsheet.
 *
 * The same shape as `gradebook-download.tsx`, and for the same reason: the record's server render
 * builds the file from the payload it drew the sessions with, so the staff-only answers reach the
 * browser only inside the finished string, and the file cannot describe different sessions from
 * the list beside it. The date in the filename is read at the press, so it is the reader's day.
 */
export function CoachingDownload({
  csv,
  fellow,
  term,
}: {
  csv: string;
  fellow: string;
  term: string;
}) {
  function download() {
    // The byte order mark is what makes Excel read this as UTF-8, so a name with an accent arrives
    // intact.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = coachingCsvFilename({ fellow, term, date: new Date() });
    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <Button variant="outline" size="sm" onClick={download}>
      <Download data-icon="inline-start" />
      Download CSV
    </Button>
  );
}
