import { PageHeader, Skeleton, SkeletonBlock } from "@/components/ui";

/** Shown while the dashboard is loading. The blocks stand where the notice, the cards, and the feed will be. */
export default function DashboardLoading() {
  return (
    <>
      <PageHeader title="Dashboard" description="Loading your profiles and activity." />
      <Skeleton label="Loading the dashboard" className="mt-6 gap-5">
        <SkeletonBlock className="h-28 w-full rounded-xl" />
        <SkeletonBlock className="mt-4 h-7 w-32" />
        <div className="grid gap-5 lg:grid-cols-2">
          <SkeletonBlock className="h-96 w-full rounded-xl" />
          <SkeletonBlock className="hidden h-96 w-full rounded-xl lg:block" />
        </div>
        <SkeletonBlock className="mt-4 h-40 w-full rounded-xl" />
        <SkeletonBlock className="mt-4 h-7 w-32" />
        <SkeletonBlock className="h-64 w-full rounded-xl" />
      </Skeleton>
    </>
  );
}
