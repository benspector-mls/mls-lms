"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A list whose rows an instructor puts in order by dragging one.
 *
 * **One component for both lists on the Curriculum screen**, which is the point rather than a
 * convenience. The units of a course and the resources inside a unit are two sequences with the
 * same rules — the server assigns every position, a move sends the whole new order, and the
 * refusal for a stale list is a reload — and written twice they would be two answers to the same
 * question, free to drift in the pixel the row lifts by, in what the screen reader says, and in
 * whether the keyboard works at all.
 *
 * **A move is the whole new order**, never "this row went from 3 to 1". Both procedures behind
 * this take a complete list and rewrite every position from it, so nothing here has to be
 * interpreted on the way and the same list sent twice is the same order.
 *
 * **The handle is the only thing that drags.** A resource row is a link, or a note that opens in
 * place, or a video that plays where it sits, and each of them carries an actions menu — four
 * things a row-wide drag listener would fight, and the reason the row itself is left alone. It is
 * also what makes the nesting below safe.
 *
 * **These nest**, because a unit's resources are drawn inside the unit row that is itself
 * draggable. Each list is its own `DndContext`, so a resource cannot be dropped into another
 * module and a drag begun on a resource handle belongs to the inner context alone. `onDragEnd`
 * refuses anything it does not recognise regardless, so the worst a stray event can do is nothing.
 */
export function SortableList({
  ids,
  onReorder,
  announce,
  children,
}: {
  /** The rows, in the order they are drawn. */
  ids: string[];
  /** The whole new order, for the procedure that rewrites every position from it. */
  onReorder: (ids: string[]) => void;
  /** What one row is called, for the screen reader. Given an id, because that is all it has. */
  announce: (id: string) => string;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /*
    Said in this application's words rather than dnd-kit's. Its defaults say "Draggable item 3 was
    moved over droppable area 1", which is a sentence about the library; an instructor moving Mod 4
    needs to hear where Mod 4 landed and how long the list is.
  */
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${announce(String(active.id))}. It is at position ${
        ids.indexOf(String(active.id)) + 1
      } of ${ids.length}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${announce(String(active.id))} is over position ${ids.indexOf(String(over.id)) + 1} of ${
            ids.length
          }.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${announce(String(active.id))} moved to position ${ids.indexOf(String(over.id)) + 1} of ${
            ids.length
          }.`
        : `${announce(String(active.id))} was dropped where it started.`,
    onDragCancel: ({ active }) => `Cancelled. ${announce(String(active.id))} is where it was.`,
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    /*
      Everything this does not recognise is a move that does not happen, rather than a guess.
      Dropped on itself, dropped on nothing, or — the case the nesting above makes possible —
      dropped on a row belonging to another list, whose id would index to -1 and send an order
      with a row missing from it. The server refuses exactly that list; this is why it never
      has to.
    */
    if (!over || active.id === over.id) return;

    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;

    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Press space or enter to pick this up. Use the up and down arrow keys to move it. " +
            "Press space or enter again to drop it, or escape to leave it where it was.",
        },
      }}
      sensors={sensors}
      collisionDetection={closestCenter}
      /*
        Vertical because both lists are, and inside its own list because two of them are on screen
        at once — a resource dragged far enough to overlap the module below it would otherwise
        look droppable there, which is a promise this cannot keep.
      */
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/**
 * One row of a `SortableList`, and the handle that moves it.
 *
 * The handle is passed back to the caller rather than drawn here, because the two lists put it in
 * different places — a unit's sits in the header bar where the up and down buttons used to be, and
 * a resource's sits at the leading edge of a row whose shape is decided by `ResourceItem`.
 */
export function SortableRow({
  id,
  label,
  as: Element = "div",
  className,
  children,
}: {
  id: string;
  /** What this row is called, for the handle's own label: "Move Mod 4". */
  label: string;
  as?: "div" | "li";
  className?: string;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label={`Move ${label}`}
      className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" />
    </button>
  );

  return (
    <Element
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      /*
        Lifted rather than merely following the pointer. Without it the row being dragged slides
        underneath the ones it passes, which reads as the list closing over it.
      */
      className={cn(isDragging && "relative z-10 opacity-80 shadow-lg", className)}
    >
      {children(handle)}
    </Element>
  );
}
