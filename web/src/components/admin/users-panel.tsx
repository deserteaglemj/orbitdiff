"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { fieldTarget, SUBMIT_TARGET } from "@/components/auth/focus-request";
import { useFocusAfterSubmit } from "@/components/auth/use-focus-after-submit";
import {
  Badge,
  Button,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  Notice,
  Pagination,
  TextField,
} from "@/components/ui";
import type { AdminUserDto, Page } from "@/server/services/contracts";

import { getJson } from "./api";
import { ADMIN_SEARCH_MAX, adminUserRow, describeResultCount, loadUsers, validateSearch } from "./users";

/** One reading inside a cell: its name, then its value. */
function Reading({ name, children }: { name: string; children: ReactNode }) {
  return (
    <span className="block">
      <span className="text-muted">{name}: </span>
      {children}
    </span>
  );
}

function UsersTable({ page, search }: { page: Page<AdminUserDto>; search: string }) {
  return (
    <DataTable caption={describeResultCount(page.pagination, search)}>
      <DataTableHead>
        <DataTableHeaderCell>Account</DataTableHeaderCell>
        <DataTableHeaderCell>Sign-up and state</DataTableHeaderCell>
        <DataTableHeaderCell>Consent</DataTableHeaderCell>
        <DataTableHeaderCell>Stored</DataTableHeaderCell>
        <DataTableHeaderCell>Activity</DataTableHeaderCell>
      </DataTableHead>
      <DataTableBody>
        {page.data.map((account) => {
          const row = adminUserRow(account);
          return (
            <DataTableRow key={row.id}>
              <DataTableCell label="Account" rowHeader>
                <span className="block break-all">{row.email}</span>
                <span className="block font-normal text-muted">{row.name}</span>
              </DataTableCell>
              <DataTableCell label="Sign-up and state">
                <span className="block tabular-nums">{row.signedUp}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={row.verified.tone}>{row.verified.label}</Badge>
                  <Badge tone={row.status.tone}>{row.status.label}</Badge>
                  <Badge tone={row.onboarding.tone}>{row.onboarding.label}</Badge>
                </span>
              </DataTableCell>
              <DataTableCell label="Consent">
                <Reading name="Terms">{row.terms}</Reading>
                <Reading name="Privacy">{row.privacy}</Reading>
                <Reading name="Marketing">{row.marketing}</Reading>
              </DataTableCell>
              <DataTableCell label="Stored" className="tabular-nums">
                <Reading name="Profiles">{row.profiles}</Reading>
                <Reading name="Snapshots">{row.snapshots}</Reading>
                <Reading name="Size">{row.storedBytes}</Reading>
              </DataTableCell>
              <DataTableCell label="Activity" className="tabular-nums">
                <Reading name="Imports, 30 days">{row.imports}</Reading>
                <Reading name="Jobs, 30 days">{row.jobs}</Reading>
                <Reading name="Last activity">{row.lastActivity}</Reading>
              </DataTableCell>
            </DataTableRow>
          );
        })}
      </DataTableBody>
    </DataTable>
  );
}

/**
 * The accounts table with its search and its pages. The first page comes from
 * the server with the screen. A search or another page is read from
 * GET /api/admin/users, which answers only for the operator. The table is read
 * only: there is no control here that changes an account.
 */
export function UsersPanel({ initial }: { initial: Page<AdminUserDto> }) {
  const formRef = useRef<HTMLFormElement>(null);
  const latest = useRef(0);
  const [page, setPage] = useState(initial);
  const [draft, setDraft] = useState("");
  const [applied, setApplied] = useState("");
  const [loading, setLoading] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [announced, setAnnounced] = useState("");
  const askFocus = useFocusAfterSubmit(formRef, !loading);

  async function load(search: string, pageNumber: number, fromForm = false): Promise<void> {
    latest.current += 1;
    const ticket = latest.current;
    setLoading(true);
    setProblem(null);
    setFieldError(undefined);
    const result = await loadUsers(getJson, { q: search, page: pageNumber });
    // A later request has started: its answer is the one to show.
    if (ticket !== latest.current) return;
    setLoading(false);
    if (!result.ok) {
      if (result.field === "q") {
        setFieldError(result.message);
        askFocus(fieldTarget("q"));
      } else {
        setProblem(result.message);
        askFocus(SUBMIT_TARGET);
      }
      return;
    }
    setPage(result.page);
    setApplied(search);
    setAnnounced(describeResultCount(result.page.pagination, search));
    // The search field was disabled while the request ran, which drops focus. Put it back.
    if (fromForm) askFocus(fieldTarget("q"));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (loading) return;
    const invalid = validateSearch(draft);
    if (invalid !== undefined) {
      setFieldError(invalid);
      askFocus(fieldTarget("q"));
      return;
    }
    void load(draft.trim(), 1, true);
  }

  function showAll(): void {
    setDraft("");
    void load("", 1, true);
  }

  const { pagination } = page;

  return (
    <div className="grid gap-5">
      <form ref={formRef} onSubmit={onSubmit} noValidate role="search" className="grid max-w-xl gap-3">
        <TextField
          label="Search by email or name"
          name="q"
          type="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={ADMIN_SEARCH_MAX}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          error={fieldError}
          hint="A part of the address or of the display name. Leave it empty to list every account."
          disabled={loading}
        />
        {problem !== null ? (
          <Notice tone="danger" live title="The accounts could not be loaded.">
            <p>{problem}</p>
            <p className="mt-1">The list below is the last one that was loaded. Search again to retry.</p>
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={loading} loadingLabel="Loading accounts">
            Search
          </Button>
          {applied.length > 0 ? (
            <Button variant="quiet" onClick={showAll} disabled={loading}>
              Show all accounts
            </Button>
          ) : null}
          {loading ? <Badge tone="info">Loading</Badge> : null}
        </div>
      </form>
      <p role="status" className="sr-only">
        {announced}
      </p>

      {page.data.length === 0 ? (
        <EmptyState
          title={describeResultCount(pagination, applied)}
          description={
            applied.length > 0
              ? "No email address or display name contains that text. Check the spelling, or list every account."
              : "Nobody has registered on this deployment yet."
          }
        />
      ) : (
        <div aria-busy={loading || undefined}>
          <UsersTable page={page} search={applied} />
        </div>
      )}
      <Pagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPageChange={(target) => void load(applied, target)}
        label="Account pages"
      />
    </div>
  );
}
