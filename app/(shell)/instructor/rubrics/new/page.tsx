import { RubricForm } from "@/components/instructor/rubric-form";
import { PageHeader } from "@/components/page-header";

export default function NewRubricPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="New rubric"
        description="The criteria, the arithmetic, and optionally a finished report of the shape you want."
      />
      <RubricForm rubric={null} />
    </div>
  );
}
