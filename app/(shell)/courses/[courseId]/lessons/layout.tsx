import { LessonsFrame } from "@/components/lesson/lessons-frame";

/** The course's lessons, read from the fellow's side; see `LessonsFrame`. */
export default function Layout({
  params,
  children,
}: {
  params: Promise<{ courseId: string }>;
  children: React.ReactNode;
}) {
  return (
    <LessonsFrame params={params} side="fellow">
      {children}
    </LessonsFrame>
  );
}
