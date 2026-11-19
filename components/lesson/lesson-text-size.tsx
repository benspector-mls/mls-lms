"use client";

import { ZoomIn } from "lucide-react";
import { usePathname } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isLessonTextSize,
  LESSON_TEXT_SIZE_KEY,
  LESSON_TEXT_SIZES,
  type LessonTextSize,
} from "@/lib/lessons/text-size";

function applySize(size: LessonTextSize) {
  document.documentElement.style.setProperty(
    "--lesson-text-scale",
    String(LESSON_TEXT_SIZES[size].scale),
  );
}

/**
 * The Magnify button, floating at the bottom right of a lesson, and its menu of three sizes with
 * the current one ticked. See `lib/lessons/text-size.ts`.
 */
export function LessonTextSizeMenu() {
  /*
    Read after the first render, so the server's markup and the browser's first pass agree, and
    applied as well as shown: the layout's script runs only on a full page load, and a reader who
    arrives by a link inside the application would otherwise see the menu tick a size the text is
    not drawn at.
  */
  const [size, setSize] = React.useState<LessonTextSize>("default");
  const pathname = usePathname();
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(LESSON_TEXT_SIZE_KEY);
      if (isLessonTextSize(saved)) {
        setSize(saved);
        applySize(saved);
      }
    } catch {
      // Storage refused; the default stands.
    }
  }, []);

  /*
    Not on the Tutor's page, which has no lesson text to size and keeps its question box at the
    bottom right, where this button would sit on the Ask button.
  */
  if (pathname.endsWith("/lessons/tutor")) return null;

  const choose = (value: unknown) => {
    if (!isLessonTextSize(value)) return;
    setSize(value);
    applySize(value);
    try {
      localStorage.setItem(LESSON_TEXT_SIZE_KEY, value);
    } catch {
      // Storage refused; the size holds until the page is left.
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label="Text size"
            title="Text size"
            className="rounded-full bg-background shadow-md"
          >
            <ZoomIn aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent side="top" align="end" className="w-40">
        <DropdownMenuRadioGroup value={size} onValueChange={choose}>
          <DropdownMenuLabel>Text size</DropdownMenuLabel>
          {(Object.keys(LESSON_TEXT_SIZES) as LessonTextSize[]).map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {LESSON_TEXT_SIZES[key].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
