import { compareCodePoints } from "../canonical";
import { DomainError } from "../errors";

/**
 * The public following-list state machine of the local product: a port of
 * `orbitdiff/diff.py`, the completeness rules of `providers/base.py`, and
 * `GraphStore.apply_collection` over an in-memory state.
 *
 * Fixture-tested only. The hosted app has no source of public following
 * lists, so no route, job, or page may import this module. It exists to keep
 * the ported semantics pinned to `src/orbitdiff/fixtures`.
 */
export interface EdgeState {
  confirmedPresent: boolean;
  pendingPresent: boolean | null;
}

export type FollowingEventType = "following_started" | "following_stopped";

export interface EdgeDecision {
  kind: "none" | "pending" | "confirm" | "clear";
  present: boolean | null;
  eventType: FollowingEventType | null;
}

const CLEAR: EdgeDecision = { kind: "clear", present: null, eventType: null };

/** `diff.reconcile`: what one complete observation does to one edge. */
export function reconcile(edge: EdgeState, observedPresent: boolean): EdgeDecision {
  if (edge.pendingPresent === null) {
    if (observedPresent === edge.confirmedPresent) {
      return { kind: "none", present: null, eventType: null };
    }
    return { kind: "pending", present: observedPresent, eventType: null };
  }
  if (observedPresent === edge.confirmedPresent) {
    return { ...CLEAR };
  }
  if (observedPresent === edge.pendingPresent) {
    return {
      kind: "confirm",
      present: observedPresent,
      eventType: observedPresent ? "following_started" : "following_stopped",
    };
  }
  return { ...CLEAR };
}

export interface FollowingAccount {
  /** The stable public profile id. Identity never rests on the username. */
  profileId: string;
  username: string;
}

export interface FollowingCollection {
  target: string;
  reportedCount: number;
  accounts: readonly FollowingAccount[];
  complete: boolean;
  /** ISO timestamp of the observation. */
  collectedAt: string;
}

function incomplete(message: string): never {
  throw new DomainError("incomplete_collection", message);
}

/** `providers.base.validate_collection`: a list is complete only on an exact count. */
export function validateCollection(collection: FollowingCollection): void {
  if (collection.complete !== true) {
    incomplete("collection was not complete");
  }
  const reported: unknown = collection.reportedCount;
  if (typeof reported !== "number" || !Number.isInteger(reported) || reported < 0) {
    incomplete("reported count must be a nonnegative integer");
  }
  const ids = collection.accounts.map((account): unknown => account.profileId);
  if (ids.some((id) => typeof id !== "string" || id === "")) {
    incomplete("accounts require a stable public profile ID");
  }
  if (new Set(ids).size !== ids.length) {
    incomplete("collection contains duplicate public profile IDs");
  }
  if (reported > 0 && ids.length === 0) {
    incomplete("reported nonzero following count collected an empty list");
  }
  if (ids.length !== reported) {
    incomplete(
      "collection count does not match the reported following count; the list is incomplete",
    );
  }
}

export interface GraphEdge extends EdgeState {
  pendingFirstSeenAt: string | null;
  pendingRunId: number | null;
}

export interface GraphRun {
  id: number;
  target: string;
  state: "success";
  runKind: "baseline" | "scan";
  collectedAt: string;
  reportedCount: number;
  collectedCount: number;
}

export interface FollowingEvent {
  eventType: FollowingEventType;
  target: string;
  actorId: string;
  /** The username current at confirmation. */
  username: string;
  firstSeenAt: string;
  confirmedAt: string;
  runId: number;
}

export interface GraphState {
  targets: Map<string, { initializedAt: string }>;
  /** Shared by every target: one username per profile id. */
  accounts: Map<string, { username: string; updatedAt: string }>;
  /** target, then actor profile id. */
  edges: Map<string, Map<string, GraphEdge>>;
  runs: GraphRun[];
  events: FollowingEvent[];
}

export function emptyGraphState(): GraphState {
  return { targets: new Map(), accounts: new Map(), edges: new Map(), runs: [], events: [] };
}

function cloneState(state: GraphState): GraphState {
  return {
    targets: new Map(Array.from(state.targets, ([key, value]) => [key, { ...value }])),
    accounts: new Map(Array.from(state.accounts, ([key, value]) => [key, { ...value }])),
    edges: new Map(
      Array.from(state.edges, ([target, edges]) => [
        target,
        new Map(Array.from(edges, ([actor, edge]) => [actor, { ...edge }])),
      ]),
    ),
    runs: state.runs.map((run) => ({ ...run })),
    events: state.events.map((event) => ({ ...event })),
  };
}

export interface ApplyResult {
  /** A new state. The state passed in is never modified. */
  state: GraphState;
  /** Events confirmed by this observation. */
  events: FollowingEvent[];
}

/**
 * `GraphStore.apply_collection`. The first complete observation of a target
 * is a silent baseline. Afterwards a change is pending on first sight and
 * confirmed by the next complete observation that shows it again; a
 * contradicting observation clears it without an event. An invalid collection
 * raises and leaves the state untouched.
 */
export function applyCollection(
  state: GraphState,
  collection: FollowingCollection,
  options: { baselineRun?: boolean } = {},
): ApplyResult {
  if (!collection.complete) {
    incomplete("incomplete collections cannot change graph state");
  }
  validateCollection(collection);
  const baselineRun = options.baselineRun === true;
  const { target, collectedAt } = collection;
  const observed = new Map(collection.accounts.map((account) => [account.profileId, account]));
  const known = state.targets.has(target);
  if (baselineRun && known) {
    return { state, events: [] };
  }

  const next = cloneState(state);
  const runId = next.runs.length + 1;
  next.runs.push({
    id: runId,
    target,
    state: "success",
    runKind: baselineRun ? "baseline" : "scan",
    collectedAt,
    reportedCount: collection.reportedCount,
    collectedCount: observed.size,
  });
  for (const account of observed.values()) {
    next.accounts.set(account.profileId, { username: account.username, updatedAt: collectedAt });
  }
  const edges = next.edges.get(target) ?? new Map<string, GraphEdge>();
  next.edges.set(target, edges);

  if (!known) {
    next.targets.set(target, { initializedAt: collectedAt });
    for (const profileId of observed.keys()) {
      edges.set(profileId, {
        confirmedPresent: true,
        pendingPresent: null,
        pendingFirstSeenAt: null,
        pendingRunId: null,
      });
    }
    return { state: next, events: [] };
  }

  const events: FollowingEvent[] = [];
  const actors = Array.from(new Set([...edges.keys(), ...observed.keys()])).sort(compareCodePoints);
  for (const actorId of actors) {
    const observedPresent = observed.has(actorId);
    const edge = edges.get(actorId);
    if (edge === undefined) {
      edges.set(actorId, {
        confirmedPresent: false,
        pendingPresent: observedPresent,
        pendingFirstSeenAt: collectedAt,
        pendingRunId: runId,
      });
      continue;
    }
    const decision = reconcile(edge, observedPresent);
    if (decision.kind === "none") {
      continue;
    }
    if (decision.kind === "pending") {
      edge.pendingPresent = observedPresent;
      edge.pendingFirstSeenAt = collectedAt;
      edge.pendingRunId = runId;
      continue;
    }
    const firstSeenAt = edge.pendingFirstSeenAt;
    edge.pendingPresent = null;
    edge.pendingFirstSeenAt = null;
    edge.pendingRunId = null;
    if (decision.kind === "clear") {
      continue;
    }
    edge.confirmedPresent = observedPresent;
    const event: FollowingEvent = {
      eventType: decision.eventType as FollowingEventType,
      target,
      actorId,
      username: next.accounts.get(actorId)?.username ?? "",
      firstSeenAt: firstSeenAt ?? "None",
      confirmedAt: collectedAt,
      runId,
    };
    next.events.push(event);
    events.push({ ...event });
  }
  return { state: next, events };
}

export interface RosterRow {
  profileId: string;
  username: string;
  confirmedPresent: boolean;
  /** The latest observation: the pending value when one exists. */
  observedPresent: boolean;
  pendingPresent: boolean | null;
  pendingFirstSeenAt: string | null;
}

/** `GraphStore.roster`: every known edge of a target, by username, then profile id. */
export function rosterOf(state: GraphState, target: string): RosterRow[] {
  const edges = state.edges.get(target);
  if (edges === undefined) {
    return [];
  }
  return Array.from(edges, ([profileId, edge]) => ({
    profileId,
    username: state.accounts.get(profileId)?.username ?? "",
    confirmedPresent: edge.confirmedPresent,
    observedPresent: edge.pendingPresent === null ? edge.confirmedPresent : edge.pendingPresent,
    pendingPresent: edge.pendingPresent,
    pendingFirstSeenAt: edge.pendingFirstSeenAt,
  })).sort(
    (left, right) =>
      compareCodePoints(left.username, right.username) ||
      compareCodePoints(left.profileId, right.profileId),
  );
}
