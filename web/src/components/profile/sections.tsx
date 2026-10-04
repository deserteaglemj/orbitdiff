import { FilterForm } from "@/components/dashboard/filter-form";
import { countSeries, netChanges } from "@/components/dashboard/card-model";
import { zoneLabel } from "@/components/dashboard/local-time";
import { buildHref, SEARCH_LENGTH } from "@/components/dashboard/query";
import {
  Badge,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  LinkButton,
  Notice,
  Pagination,
  SelectField,
  Sparkline,
  TextField,
} from "@/components/ui";
import type {
  CountHistoryDto,
  ExportEventDto,
  ExportEventType,
  Page,
  Relationship,
  RelationshipDto,
  SnapshotDto,
} from "@/server/services/contracts";

import {
  ABSENCE_NOTE,
  changeRow,
  type ChangesState,
  countRows,
  EVENT_TYPE_OPTIONS,
  profileHref,
  RELATIONSHIP_OPTIONS,
  relationshipRow,
  snapshotRow,
} from "./rows";

const MONO = "font-mono";

function ImportAction({ href }: { href: string }) {
  return (
    <LinkButton href={href} variant="secondary">
      Import export
    </LinkButton>
  );
}

function ProcessingNote() {
  return (
    <Notice tone="info" label="Processing" title="An import is still being processed.">
      <p>This section shows the last processed result until processing finishes.</p>
    </Notice>
  );
}

export interface RelationshipFiltersView {
  q: string;
  relationship: Relationship | null;
  page: number;
}

/** Accounts of the current export, with both directions as Yes, No, or Unknown. */
export function RelationshipsSection({
  profileId,
  hasImport,
  importHref,
  filters,
  page,
}: {
  profileId: string;
  hasImport: boolean;
  importHref: string;
  filters: RelationshipFiltersView;
  page: Page<RelationshipDto>;
}) {
  const path = profileHref(profileId);
  const filtered = filters.q !== "" || filters.relationship !== null;
  const hrefFor = (target: number) =>
    buildHref(path, { q: filters.q, relationship: filters.relationship, page: target }, "section");
  if (!hasImport) {
    return (
      <EmptyState
        title="No import yet"
        description="Import your followers and following export to see who is mutual and who does not follow back."
        action={<ImportAction href={importHref} />}
      />
    );
  }
  const rows = page.data.map(relationshipRow);
  return (
    <div className="grid gap-5">
      <p className="max-w-[75ch] text-sm text-ink">{ABSENCE_NOTE}</p>
      <FilterForm
        key={JSON.stringify([filters.q, filters.relationship])}
        action={path}
        label="Search and filter relationships"
        filtered={filtered}
        clearHref={buildHref(path, {}, "section")}
      >
        <TextField
          label="Search usernames"
          name="q"
          type="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={SEARCH_LENGTH}
          defaultValue={filters.q}
          inputClassName={MONO}
        />
        <SelectField
          label="Relationship"
          name="relationship"
          autoComplete="off"
          defaultValue={filters.relationship ?? ""}
          options={RELATIONSHIP_OPTIONS}
        />
      </FilterForm>
      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No accounts match" : page.pagination.totalItems > 0 ? "No accounts on this page" : "The current export lists no accounts"}
          description={
            filtered
              ? "No account of the current export matches this search and filter."
              : "The current export holds no usernames on this page."
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted tabular-nums">
            {page.pagination.totalItems} {filtered ? "matching " : ""}
            {page.pagination.totalItems === 1 ? "account" : "accounts"} in the current export.
          </p>
          <DataTable caption="Accounts of the current export" captionHidden>
            <DataTableHead>
              <DataTableHeaderCell>Username</DataTableHeaderCell>
              <DataTableHeaderCell>You follow</DataTableHeaderCell>
              <DataTableHeaderCell>Follows you</DataTableHeaderCell>
              <DataTableHeaderCell>Relationship</DataTableHeaderCell>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <DataTableRow key={row.username}>
                  <DataTableCell label="Username" rowHeader className={MONO}>
                    <span translate="no">{row.username}</span>
                  </DataTableCell>
                  <DataTableCell label="You follow">{row.youFollow}</DataTableCell>
                  <DataTableCell label="Follows you">{row.followsYou}</DataTableCell>
                  <DataTableCell label="Relationship">{row.relationship}</DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </>
      )}
      <Pagination page={filters.page} totalPages={page.pagination.totalPages} hrefFor={hrefFor} label="Relationship pages" />
    </div>
  );
}

export interface ChangeFiltersView {
  q: string;
  type: ExportEventType | null;
  page: number;
}

/**
 * Differences between consecutive dated exports. The first dated import is a
 * baseline and has no entries. Every row is labelled an export observation
 * and carries the interval between the two capture times.
 */
export function ChangesSection({
  profileId,
  importHref,
  state,
  processing,
  filters,
  page,
  timeZone,
}: {
  profileId: string;
  importHref: string;
  state: ChangesState;
  processing: boolean;
  filters: ChangeFiltersView;
  page: Page<ExportEventDto>;
  timeZone: string;
}) {
  const path = profileHref(profileId);
  const fixed = { tab: "changes" };
  const filtered = filters.q !== "" || filters.type !== null;
  const hrefFor = (target: number) =>
    buildHref(path, { ...fixed, q: filters.q, type: filters.type, page: target }, "section");
  const showFilters = state.kind === "list" || state.kind === "no_match";
  const rows = page.data.map((event) => changeRow(event, timeZone));

  return (
    <div className="grid gap-5">
      {processing && showFilters ? <ProcessingNote /> : null}
      {showFilters ? (
        <FilterForm
          key={JSON.stringify([filters.q, filters.type])}
          action={path}
          fixed={fixed}
          label="Search and filter export observations"
          filtered={filtered}
          clearHref={buildHref(path, fixed, "section")}
        >
          <TextField
            label="Search usernames"
            name="q"
            type="search"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={SEARCH_LENGTH}
            defaultValue={filters.q}
            inputClassName={MONO}
          />
          <SelectField
            label="Difference"
            name="type"
            autoComplete="off"
            defaultValue={filters.type ?? ""}
            options={EVENT_TYPE_OPTIONS}
          />
        </FilterForm>
      ) : null}

      {state.kind === "list" && rows.length > 0 ? (
        <>
          <p className="max-w-[75ch] text-sm text-ink">
            {page.pagination.totalItems} {filtered ? "matching " : ""}export{" "}
            {page.pagination.totalItems === 1 ? "observation" : "observations"}. {state.detail}
          </p>
          <DataTable caption="Export observations" captionHidden>
            <DataTableHead>
              <DataTableHeaderCell>Username</DataTableHeaderCell>
              <DataTableHeaderCell>Difference</DataTableHeaderCell>
              <DataTableHeaderCell>Observed</DataTableHeaderCell>
              <DataTableHeaderCell>Evidence</DataTableHeaderCell>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <DataTableRow key={row.id}>
                  <DataTableCell label="Username" rowHeader className={MONO}>
                    <span translate="no">{row.username}</span>
                  </DataTableCell>
                  <DataTableCell label="Difference">{row.difference}</DataTableCell>
                  <DataTableCell label="Observed" className="tabular-nums">
                    {row.observed}
                  </DataTableCell>
                  <DataTableCell label="Evidence">
                    <Badge tone="neutral">{row.evidence}</Badge>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </>
      ) : state.kind === "list" ? (
        <EmptyState title="No observations on this page" description="Go back to an earlier page of the list." />
      ) : (
        <EmptyState
          title={state.title}
          description={state.detail}
          action={
            state.kind === "no_match" || state.kind === "pending" ? undefined : <ImportAction href={importHref} />
          }
        />
      )}
      <Pagination page={filters.page} totalPages={page.pagination.totalPages} hrefFor={hrefFor} label="Observation pages" />
    </div>
  );
}

/** Every stored import, newest capture first, with its coverage per direction. */
export function ImportsSection({
  profileId,
  importHref,
  page,
  pageNumber,
  timeZone,
}: {
  profileId: string;
  importHref: string;
  page: Page<SnapshotDto>;
  pageNumber: number;
  timeZone: string;
}) {
  const path = profileHref(profileId);
  const rows = page.data.map((snapshot) => snapshotRow(snapshot, timeZone));
  if (page.pagination.totalItems === 0) {
    return (
      <EmptyState
        title="No import yet"
        description="Each import you store appears here with its capture time, its coverage, and its counts."
        action={<ImportAction href={importHref} />}
      />
    );
  }
  return (
    <div className="grid gap-5">
      <p className="max-w-[75ch] text-sm text-ink">
        {page.pagination.totalItems} stored {page.pagination.totalItems === 1 ? "import" : "imports"}. The capture time
        is the one you declared. A count is shown only for a direction with complete coverage. Coverage is declared by
        you and is not checked by OrbitDiff Web.
      </p>
      <DataTable caption="Stored imports" captionHidden>
        <DataTableHead>
          <DataTableHeaderCell>Capture time</DataTableHeaderCell>
          <DataTableHeaderCell>Imported</DataTableHeaderCell>
          <DataTableHeaderCell>Followers coverage</DataTableHeaderCell>
          <DataTableHeaderCell>Following coverage</DataTableHeaderCell>
          <DataTableHeaderCell align="right">Followers</DataTableHeaderCell>
          <DataTableHeaderCell align="right">Following</DataTableHeaderCell>
          <DataTableHeaderCell>Current</DataTableHeaderCell>
        </DataTableHead>
        <DataTableBody>
          {rows.map((row) => (
            <DataTableRow key={row.id}>
              <DataTableCell label="Capture time" rowHeader className="tabular-nums">
                {row.captured}
              </DataTableCell>
              <DataTableCell label="Imported" className="tabular-nums">
                {row.imported}
              </DataTableCell>
              <DataTableCell label="Followers coverage">{row.followersCoverage}</DataTableCell>
              <DataTableCell label="Following coverage">{row.followingCoverage}</DataTableCell>
              <DataTableCell label="Followers" align="right" className="tabular-nums">
                {row.followers}
              </DataTableCell>
              <DataTableCell label="Following" align="right" className="tabular-nums">
                {row.following}
              </DataTableCell>
              <DataTableCell label="Current">
                {row.current ? <Badge tone="info">Current</Badge> : <span className="text-muted">No</span>}
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
      <Pagination
        page={pageNumber}
        totalPages={page.pagination.totalPages}
        hrefFor={(target) => buildHref(path, { tab: "imports", page: target }, "section")}
        label="Import history pages"
      />
    </div>
  );
}

/** The count series and the net change wording. Numbers only: a count never names accounts. */
export function CountsSection({
  importHref,
  history,
  timeZone,
}: {
  importHref: string;
  history: CountHistoryDto;
  timeZone: string;
}) {
  if (history.points.length === 0) {
    return (
      <EmptyState
        title="No count history yet"
        description="A count needs a dated export with a direction you declared complete. Undated and partial exports add no point, so they never look like a drop."
        action={<ImportAction href={importHref} />}
      />
    );
  }
  const changes = netChanges(history);
  const series = (["followers", "following"] as const).map((direction) => ({
    direction,
    label: direction === "followers" ? "Followers" : "Following",
    points: countSeries(history, direction, timeZone),
  }));
  return (
    <div className="grid gap-6">
      <p className="max-w-[75ch] text-sm text-ink">
        One point per dated export with a direction you declared complete. A change between two points is a net change
        of a count. It says nothing about which accounts differ.
      </p>
      <div className="grid gap-5 sm:grid-cols-2">
        {series.map((item) => {
          const change = changes.find((entry) => entry.label === item.label);
          return (
            <div key={item.direction} className="min-w-0 rounded-xl border border-line bg-surface p-5">
              <h3 className="text-base font-semibold text-ink">{item.label}</h3>
              <p className="mt-1 text-sm text-ink">
                {change ? change.text : "No net change to report: fewer than two counts are known."}
              </p>
              {item.points.length >= 2 ? (
                <Sparkline points={item.points} showSummary className="mt-3" />
              ) : (
                <p className="mt-3 text-sm text-muted">A trend line needs two known counts.</p>
              )}
            </div>
          );
        })}
      </div>
      <DataTable caption={`Counts per dated export, newest first. Times are in ${zoneLabel(timeZone)}.`}>
        <DataTableHead>
          <DataTableHeaderCell>Capture time</DataTableHeaderCell>
          <DataTableHeaderCell align="right">Followers</DataTableHeaderCell>
          <DataTableHeaderCell align="right">Following</DataTableHeaderCell>
        </DataTableHead>
        <DataTableBody>
          {countRows(history, timeZone).map((row) => (
            <DataTableRow key={row.id}>
              <DataTableCell label="Capture time" rowHeader className="tabular-nums">
                {row.captured}
              </DataTableCell>
              <DataTableCell label="Followers" align="right" className="tabular-nums">
                {row.followers}
              </DataTableCell>
              <DataTableCell label="Following" align="right" className="tabular-nums">
                {row.following}
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    </div>
  );
}
