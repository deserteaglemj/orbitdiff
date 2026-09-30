"use client";

import { useEffect, useState } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  Badge,
  Button,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  LinkButton,
  Notice,
  Skeleton,
} from "@/components/ui";
import { authClient } from "@/lib/auth-client";

import { formatDateTime } from "./format";
import { describeSecurityError, sessionRows, type SecurityFailure, type SessionRow } from "./security";

const OFFLINE = "The request did not reach the server. Check your connection and try again.";

export interface SessionsTableProps {
  rows: SessionRow[];
  timeZone: string;
  /** The key of the row whose sign-out is running, "others" for all other devices, or null. */
  busyKey: string | null;
  onRevoke: (row: SessionRow) => void;
}

/**
 * The signed-in devices. A row shows the device name worked out from its
 * browser description, the network address, and the times. The token of a
 * session is used only to sign that device out: it is never rendered.
 */
export function SessionsTable({ rows, timeZone, busyKey, onRevoke }: SessionsTableProps) {
  return (
    <DataTable caption="Devices signed in to your OrbitDiff account" captionHidden>
      <DataTableHead>
        <DataTableHeaderCell>Device</DataTableHeaderCell>
        <DataTableHeaderCell>Network address</DataTableHeaderCell>
        <DataTableHeaderCell>Signed in</DataTableHeaderCell>
        <DataTableHeaderCell>Expires</DataTableHeaderCell>
        <DataTableHeaderCell align="right">Sign out</DataTableHeaderCell>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => {
          const signedIn = formatDateTime(row.signedInAt, timeZone);
          return (
            <DataTableRow key={row.key}>
              <DataTableCell label="Device" rowHeader>
                <span className="flex flex-wrap items-center gap-2">
                  {row.device}
                  {row.current ? <Badge tone="info">This device</Badge> : null}
                </span>
              </DataTableCell>
              <DataTableCell label="Network address" className="font-mono break-all">
                {row.address}
              </DataTableCell>
              <DataTableCell label="Signed in" className="tabular-nums">
                {signedIn}
              </DataTableCell>
              <DataTableCell label="Expires" className="tabular-nums">
                {formatDateTime(row.expiresAt, timeZone)}
              </DataTableCell>
              <DataTableCell label="Sign out" align="right">
                {row.current ? (
                  <span className="text-muted">You are using it now.</span>
                ) : (
                  <Button
                    variant="secondary"
                    aria-label={`Sign out this device: ${row.device}, signed in ${signedIn}`}
                    onClick={() => onRevoke(row)}
                    loading={busyKey === row.key}
                    loadingLabel={`Signing out ${row.device}`}
                    disabled={busyKey !== null && busyKey !== row.key}
                  >
                    Sign out this device
                  </Button>
                )}
              </DataTableCell>
            </DataTableRow>
          );
        })}
      </DataTableBody>
    </DataTable>
  );
}

type Fetched = { ok: true; rows: SessionRow[] } | { ok: false; failure: SecurityFailure };

interface View {
  loading: boolean;
  /** The last list the server returned, or null before the first answer. */
  rows: SessionRow[] | null;
  problem: SecurityFailure | null;
}

/** A refusal about a password field has no field here, so it is shown as a plain failure. */
function describeFailure(error: unknown): SecurityFailure {
  const failure = describeSecurityError(error);
  return failure.kind === "field" ? { kind: "form", message: failure.message } : failure;
}

/** Ask the auth client for the active sessions and for the login of this browser. It never throws. */
async function fetchSessions(): Promise<Fetched> {
  try {
    const [list, current] = await Promise.all([authClient.listSessions(), authClient.getSession()]);
    if (list.error) return { ok: false, failure: describeFailure(list.error) };
    return { ok: true, rows: sessionRows(list.data, current.data?.session?.token ?? null) };
  } catch {
    return { ok: false, failure: { kind: "form", message: OFFLINE } };
  }
}

/** A failed reload keeps the last good list next to the failure. A login that ended keeps nothing. */
function merge(before: View, fetched: Fetched): View {
  if (fetched.ok) return { loading: false, rows: fetched.rows, problem: null };
  const keep = fetched.failure.kind === "form" ? before.rows : null;
  return { loading: false, rows: keep, problem: fetched.failure };
}

/**
 * Sign out here, sign out every other device, and the list of active logins
 * with a sign-out for each. The list is read in the browser through the auth
 * client once the page is open, so no session token is part of the page the
 * server sends.
 */
export function SessionsPanel({ timeZone }: { timeZone: string }) {
  const [view, setView] = useState<View>({ loading: true, rows: null, problem: null });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let active = true;
    void fetchSessions().then((fetched) => {
      if (active) setView((before) => merge(before, fetched));
    });
    return () => {
      active = false;
    };
  }, []);

  async function reload(): Promise<void> {
    setView((before) => ({ ...before, loading: true }));
    const fetched = await fetchSessions();
    setView((before) => merge(before, fetched));
  }

  /** Run one sign-out request, then read the list again. */
  async function run(key: string, done: string, request: () => Promise<{ error: unknown }>): Promise<void> {
    if (busyKey !== null) return;
    setBusyKey(key);
    setNote("");
    let failure: SecurityFailure | null = null;
    try {
      const { error } = await request();
      if (error) failure = describeFailure(error);
    } catch {
      failure = { kind: "form", message: OFFLINE };
    }
    if (failure === null) {
      setNote(done);
      await reload();
    } else {
      const problem = failure;
      // A login that ended has no list to show. Any other failure keeps the last one.
      setView((before) => ({ ...before, rows: problem.kind === "signed_out" ? null : before.rows, problem }));
    }
    setBusyKey(null);
  }

  const revoke = (row: SessionRow) =>
    run(row.key, `${row.device} was signed out.`, () => authClient.revokeSession({ token: row.token }));
  const revokeOthers = () =>
    run("others", "Every other device was signed out.", () => authClient.revokeOtherSessions());

  const { loading, rows, problem } = view;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SignOutButton />
        <Button
          variant="secondary"
          onClick={revokeOthers}
          loading={busyKey === "others"}
          loadingLabel="Signing out all other devices"
          disabled={busyKey !== null && busyKey !== "others"}
        >
          Sign out of all other devices
        </Button>
      </div>
      <p role="status" className="min-h-6 text-sm text-ink">
        {note}
      </p>

      {problem?.kind === "form" ? (
        <>
          <Notice tone="danger" live title="That did not work.">
            <p>{problem.message}</p>
            {rows !== null ? <p className="mt-1">The list below is the last one that was loaded.</p> : null}
          </Notice>
          {/* Outside the notice: the border of a secondary button does not stand out on the danger fill. */}
          <div>
            <Button variant="secondary" onClick={reload} disabled={loading || busyKey !== null}>
              Load the list again
            </Button>
          </div>
        </>
      ) : null}
      {problem?.kind === "not_fresh" ? (
        <Notice tone="info" live title="The list is shown for one day after you sign in.">
          <p>{problem.message} Signing out of all other devices still works.</p>
        </Notice>
      ) : null}
      {problem?.kind === "signed_out" ? (
        <Notice
          tone="warning"
          live
          title="This device is signed out."
          actions={
            <LinkButton href="/sign-in?next=%2Fsettings" variant="secondary">
              Sign in again
            </LinkButton>
          }
        >
          <p>{problem.message}</p>
        </Notice>
      ) : null}

      {rows === null && loading ? (
        <Skeleton label="Loading the signed-in devices" lines={3} />
      ) : null}
      {rows !== null && rows.length === 0 ? (
        <p className="text-sm text-muted">The server returned no signed-in device.</p>
      ) : null}
      {rows !== null && rows.length > 0 ? (
        <div aria-busy={loading || undefined}>
          {loading ? (
            <p className="mb-2">
              <Badge tone="info">Updating the list</Badge>
            </p>
          ) : null}
          <SessionsTable rows={rows} timeZone={timeZone} busyKey={busyKey} onRevoke={revoke} />
        </div>
      ) : null}
    </div>
  );
}
