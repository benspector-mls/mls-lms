import Link from 'next/link';
import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';

import { Gradebook } from '@/components/instructor/gradebook';
import { ListSkeleton } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * The gradebook on its own, with the width of the page to itself.
 *
 * The same grid appears as a tab on the course page. A cohort against a term's worth of
 * assignments is wider than that tab, and this is where it is actually read.
 */
export default function GradebookPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  return (
    <Suspense fallback={<GradebookFallback />}>
      <FullGradebook params={params} />
    </Suspense>
  );
}

function GradebookFallback() {
  return (
    <div className="p-4 md:p-6">
      <ListSkeleton rows={10} />
    </div>
  );
}

async function FullGradebook({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const data = await getQueryClient().fetchQuery(
    trpc.courses.gradebook.queryOptions({ courseId }),
  );

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <Link
        href={`/instructor/courses/${courseId}`}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          '-ml-2 w-fit text-muted-foreground',
        )}
      >
        <ArrowLeft data-icon="inline-start" />
        {data.course.name}
      </Link>

      <PageHeader
        title="Gradebook"
        description={`${data.course.cohortTerm} · every student against every assignment`}
      />

      <Gradebook data={data} />
    </div>
  );
}
