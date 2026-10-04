import { formatDateTime } from "@/components/settings/format";
import { PageHeader, Panel } from "@/components/ui";
import type { AdminUserDto, CapacityDto, Page } from "@/server/services/contracts";

import { CapacityPanel } from "./capacity-panel";
import { UsersPanel } from "./users-panel";

export interface AdminScreenProps {
  /** From getCapacity() with the id requireAdmin returned. */
  capacity: CapacityDto;
  /** The first page of listUsers() with the same id. */
  users: Page<AdminUserDto>;
  /** ISO time the page was rendered at. The readings are as of this moment. */
  now: string;
}

/**
 * The operator's view. It shows that accounts exist and how much they store,
 * never what they store: no password, token, roster, or Instagram username is
 * part of what the services return, and nothing else is rendered.
 *
 * Read only. The only controls search the accounts and page through them.
 */
export function AdminScreen({ capacity, users, now }: AdminScreenProps) {
  return (
    <>
      <PageHeader
        title="Admin"
        description="Read only. Capacity of this deployment and its accounts, without what the accounts store. Times are in UTC."
      />
      <div className="mt-6 grid gap-8">
        <Panel
          title="Capacity"
          description={`Counts against the configured caps, as of ${formatDateTime(now, "UTC")}. Reload the page for newer readings.`}
        >
          <CapacityPanel capacity={capacity} now={new Date(now)} />
        </Panel>
        <Panel
          title="Accounts"
          description="Every OrbitDiff account with its state, its recorded consent, and how much it stores and does."
        >
          <UsersPanel initial={users} />
        </Panel>
      </div>
    </>
  );
}
