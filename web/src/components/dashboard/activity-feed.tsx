import Link from "next/link";

import {
  Badge,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  Pagination,
  SelectField,
  TextField,
} from "@/components/ui";
import type { ActivityDto, Page } from "@/server/services/contracts";

import {
  ACTIVITY_ANCHOR,
  ACTIVITY_KIND_OPTIONS,
  ACTIVITY_STATUS_OPTIONS,
  activityHref,
  activityRow,
  type ActivityQuery,
} from "./activity-model";
import { FilterForm } from "./filter-form";
import { zoneLabel } from "./local-time";
import { SEARCH_LENGTH } from "./query";

const NO_FILTERS: ActivityQuery = { profileId: null, kind: null, status: null, q: "", page: 1 };

/**
 * The activity feed with its filters and pages. The dashboard shows it for
 * every profile, with a search by handle and a profile filter; a profile page
 * shows it for that profile alone. Each entry is worded by the service. A
 * failure is its own entry and leaves the entries of earlier results as they
 * are.
 */
export function ActivityFeed({
  path,
  fixed = {},
  query,
  page,
  timeZone,
  profiles,
  anchor = ACTIVITY_ANCHOR,
}: {
  /** Path of the page the feed is on. */
  path: string;
  /** Parameters of that page to keep in every link. */
  fixed?: Record<string, string>;
  query: ActivityQuery;
  page: Page<ActivityDto>;
  timeZone: string;
  /** The user's profiles. When given, the feed offers the search by handle and the profile filter. */
  profiles?: Array<{ id: string; handle: string }>;
  /** The id of the section the feed sits in. Links to another page of the feed scroll to it. */
  anchor?: string;
}) {
  const filtered = query.q !== "" || query.profileId !== null || query.kind !== null || query.status !== null;
  const rows = page.data.map((entry) => activityRow(entry, timeZone));
  const { totalItems, totalPages } = page.pagination;

  return (
    <div className="grid gap-5">
      <FilterForm
        key={JSON.stringify([query.q, query.profileId, query.kind, query.status])}
        action={path}
        fixed={fixed}
        label="Search and filter activity"
        filtered={filtered}
        clearHref={activityHref(path, NO_FILTERS, 1, fixed, anchor)}
      >
        {profiles ? (
          <>
            <TextField
              label="Search by profile handle"
              name="q"
              type="search"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={SEARCH_LENGTH}
              defaultValue={query.q}
              inputClassName="font-mono"
            />
            <SelectField
              label="Profile"
              name="profile"
              autoComplete="off"
              defaultValue={query.profileId ?? ""}
              options={[
                { value: "", label: "All profiles" },
                ...profiles.map((profile) => ({ value: profile.id, label: profile.handle })),
              ]}
            />
          </>
        ) : null}
        <SelectField
          label="Kind"
          name="kind"
          autoComplete="off"
          defaultValue={query.kind ?? ""}
          options={ACTIVITY_KIND_OPTIONS}
        />
        <SelectField
          label="Status"
          name="status"
          autoComplete="off"
          defaultValue={query.status ?? ""}
          options={ACTIVITY_STATUS_OPTIONS}
        />
      </FilterForm>

      {rows.length === 0 ? (
        totalItems > 0 ? (
          <EmptyState
            title="No entries on this page"
            description={`There are ${totalItems} entries on ${totalPages} ${totalPages === 1 ? "page" : "pages"}.`}
            action={
              <Link href={activityHref(path, query, 1, fixed, anchor)} scroll={false} className="od-link inline-block py-1">
                Go to the first page
              </Link>
            }
          />
        ) : filtered ? (
          <EmptyState
            title="No activity matches"
            description="No entry matches this search and these filters. Clear them to see everything."
          />
        ) : (
          <EmptyState
            title="No activity yet"
            description="Adding a profile, importing an export, and each review appear here with their result."
          />
        )
      ) : (
        <>
          <p className="text-sm text-muted">
            {totalItems} {totalItems === 1 ? "entry" : "entries"}, newest first. Times are in {zoneLabel(timeZone)}.
          </p>
          <DataTable caption="Activity entries" captionHidden>
            <DataTableHead>
              <DataTableHeaderCell>What happened</DataTableHeaderCell>
              <DataTableHeaderCell>Status</DataTableHeaderCell>
              {profiles ? <DataTableHeaderCell>Profile</DataTableHeaderCell> : null}
              <DataTableHeaderCell>When</DataTableHeaderCell>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <DataTableRow key={row.id}>
                  <DataTableCell label="What happened" rowHeader>
                    <span className="block font-medium text-ink">{row.title}</span>
                    {row.detail ? <span className="mt-0.5 block font-normal text-muted">{row.detail}</span> : null}
                    {row.kind !== row.title ? (
                      <span className="mt-0.5 block text-xs font-normal text-muted">{row.kind}</span>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell label="Status">
                    <Badge tone={row.badge.tone}>{row.badge.text}</Badge>
                  </DataTableCell>
                  {profiles ? (
                    <DataTableCell label="Profile">
                      {row.handle && row.profileHref ? (
                        <Link href={row.profileHref} translate="no" className="od-link inline-block py-1 font-mono">
                          {row.handle}
                        </Link>
                      ) : (
                        <span className="text-muted">No profile</span>
                      )}
                    </DataTableCell>
                  ) : null}
                  <DataTableCell label="When" className="tabular-nums">
                    {row.when}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </>
      )}

      <Pagination
        page={query.page}
        totalPages={totalPages}
        hrefFor={(target) => activityHref(path, query, target, fixed, anchor)}
        label="Activity pages"
      />
    </div>
  );
}
