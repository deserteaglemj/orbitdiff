import { PageHeader, Skeleton, SkeletonBlock } from "@/components/ui";

/**
 * Shown while the settings page reads the account. It keeps the page title in
 * place and stands in for the first panels, so nothing jumps when they arrive.
 */
export default function SettingsLoading() {
  return (
    <>
      <PageHeader title="Settings" />
      <Skeleton label="Loading your settings" className="mt-6">
        <SkeletonBlock className="h-5 w-72 max-w-full" />
        <SkeletonBlock className="h-80 w-full rounded-xl" />
        <SkeletonBlock className="h-48 w-full rounded-xl" />
      </Skeleton>
    </>
  );
}
