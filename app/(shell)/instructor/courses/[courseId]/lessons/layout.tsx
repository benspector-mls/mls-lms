import { LessonsFrame } from "@/components/lesson/lessons-frame";

/** The course's lessons, read from the instructor's side; see `LessonsFrame`. */
export default function Layout({
  params,
  children,
}: {
  params: Promise<{ courseId: string }>;
  children: React.ReactNode;
}) {
  return (
    <LessonsFrame params={params} side="instructor">
      {children}
    </LessonsFrame>
  );
}
