import "server-only";

import { isIP } from "node:net";

import { CAPACITY_DEFAULTS } from "@/domain/limits";

export type Stage = "development" | "test" | "staging" | "production";
export type EmailTransport = "capture" | "none";

/** Validated server configuration. Secrets live here and nowhere else. */
export interface Env {
  stage: Stage;
  /** Origin of the deployment, without a trailing slash. */
  baseUrl: string;
  commitSha: string | null;
  databaseUrl: string;
  /** Direct connection for migrations. Falls back to the pooled URL. */
  databaseUrlUnpooled: string;
  authSecret: string;
  jobsTickSecret: string;
  /** Lowercased, trimmed addresses that may use the admin surface. */
  adminEmails: ReadonlySet<string>;
  emailTransport: EmailTransport;
  mailboxSecret: string | null;
  signupAccessCode: string | null;
  /**
   * Who runs this deployment, as shown on the legal pages. Null until the
   * operator sets OPERATOR_NAME: registration stays closed while it is null.
   */
  operatorName: string | null;
  capacity: { maxUsers: number; maxJobsPerDay: number; maxDatabaseBytes: number };
  /**
   * Lowercased name of the request header that carries the client address.
   * The hosting platform must set AND overwrite it: the rate limiter trusts
   * its value, so a header a caller can send through unchanged defeats the
   * per-client limits. Default `x-forwarded-for`, which Vercel overwrites.
   */
  clientIpHeader: string;
  /**
   * Proxy addresses or CIDR ranges that may appear in that header. When set,
   * the client is the last hop that is not one of them. Empty means the header
   * is expected to hold a single address.
   */
  trustedProxies: readonly string[];
}

/**
 * Raised when configuration is missing or invalid. The message lists variable
 * NAMES and a fixed reason. It never contains a configured value.
 */
export class EnvError extends Error {
  readonly variables: readonly string[];

  constructor(problems: ReadonlyArray<{ name: string; reason: string }>) {
    super(
      `Invalid configuration: ${problems.map((p) => `${p.name} (${p.reason})`).join("; ")}`,
    );
    this.name = "EnvError";
    this.variables = problems.map((p) => p.name);
  }
}

const STAGES: readonly Stage[] = ["development", "test", "staging", "production"];
const TRANSPORTS: readonly EmailTransport[] = ["capture", "none"];
const SECRET_MIN = 32;
const ACCESS_CODE_MIN = 12;
const EMAIL_SHAPE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const COMMIT_SHAPE = /^[0-9A-Za-z._-]{1,64}$/;
const HEADER_SHAPE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Headers that carry credentials can never be the client address header. */
const CREDENTIAL_HEADERS = new Set(["cookie", "authorization", "proxy-authorization", "x-signup-code"]);
const DEFAULT_CLIENT_IP_HEADER = "x-forwarded-for";
const OPERATOR_NAME_MIN = 2;
const OPERATOR_NAME_MAX = 80;

type Source = Record<string, string | undefined>;

/**
 * The operator name as it may be shown, or null. It fails closed: anything that
 * is not a string of 2 to 80 characters after trimming counts as "not named".
 */
export function normalizeOperatorName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= OPERATOR_NAME_MIN && name.length <= OPERATOR_NAME_MAX ? name : null;
}

/**
 * Read OPERATOR_NAME on its own. The legal pages use this, so they can say who
 * runs the service (or that nobody has been named) on a deployment whose other
 * configuration is missing.
 */
export function readOperatorName(source: Source = process.env): string | null {
  return normalizeOperatorName(source.OPERATOR_NAME);
}

export function parseEnv(source: Source): Env {
  const problems: Array<{ name: string; reason: string }> = [];
  const fail = (name: string, reason: string) => {
    if (!problems.some((p) => p.name === name)) problems.push({ name, reason });
  };
  const read = (name: string): string | null => {
    const value = source[name]?.trim();
    return value ? value : null;
  };

  const stageRaw = read("APP_STAGE");
  const stage = STAGES.find((candidate) => candidate === stageRaw) ?? null;
  if (!stage) fail("APP_STAGE", `must be one of ${STAGES.join(", ")}`);

  let baseUrl = "";
  const baseUrlRaw = read("APP_BASE_URL");
  if (!baseUrlRaw) fail("APP_BASE_URL", "is required");
  else {
    const parsed = parseUrl(baseUrlRaw);
    if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
      fail("APP_BASE_URL", "must be an absolute http or https URL");
    } else if ((stage === "staging" || stage === "production") && parsed.protocol !== "https:") {
      fail("APP_BASE_URL", "must use https in staging and production");
    } else {
      baseUrl = parsed.origin;
    }
  }

  const commitSha = read("APP_COMMIT_SHA");
  if (commitSha && !COMMIT_SHAPE.test(commitSha)) {
    fail("APP_COMMIT_SHA", "must be a short revision identifier");
  }

  const databaseUrl = readPostgresUrl("DATABASE_URL", read, fail, true);
  const databaseUrlUnpooled = readPostgresUrl("DATABASE_URL_UNPOOLED", read, fail, false);

  const authSecret = readSecret("BETTER_AUTH_SECRET", read, fail, true);
  const jobsTickSecret = readSecret("JOBS_TICK_SECRET", read, fail, true);

  const adminEmails = new Set<string>();
  for (const entry of (read("ADMIN_EMAILS") ?? "").split(",")) {
    const email = entry.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_SHAPE.test(email)) fail("ADMIN_EMAILS", "must be a comma-separated list of email addresses");
    else adminEmails.add(email);
  }

  const transportRaw = read("EMAIL_TRANSPORT") ?? "none";
  const emailTransport = TRANSPORTS.find((candidate) => candidate === transportRaw) ?? null;
  if (!emailTransport) fail("EMAIL_TRANSPORT", `must be one of ${TRANSPORTS.join(", ")}`);
  else if (emailTransport === "capture" && stage === "production") {
    fail("EMAIL_TRANSPORT", "capture is not allowed in production");
  }

  const mailboxSecret = readSecret("MAILBOX_SECRET", read, fail, false);
  if (!read("MAILBOX_SECRET") && stage === "staging" && emailTransport === "capture") {
    fail("MAILBOX_SECRET", "is required when staging captures mail");
  }

  const signupAccessCode = read("SIGNUP_ACCESS_CODE");
  if (signupAccessCode && signupAccessCode.length < ACCESS_CODE_MIN) {
    fail("SIGNUP_ACCESS_CODE", `must be at least ${ACCESS_CODE_MIN} characters`);
  }

  const operatorRaw = read("OPERATOR_NAME");
  const operatorName = normalizeOperatorName(operatorRaw);
  if (operatorRaw !== null && operatorName === null) {
    fail("OPERATOR_NAME", `must be ${OPERATOR_NAME_MIN} to ${OPERATOR_NAME_MAX} characters`);
  }

  const capacity = {
    maxUsers: readCount("CAPACITY_MAX_USERS", CAPACITY_DEFAULTS.maxUsers, read, fail),
    maxJobsPerDay: readCount("CAPACITY_MAX_JOBS_PER_DAY", CAPACITY_DEFAULTS.maxJobsPerDay, read, fail),
    maxDatabaseBytes: readCount("CAPACITY_MAX_DB_BYTES", CAPACITY_DEFAULTS.maxDatabaseBytes, read, fail),
  };

  const clientIpHeader = (read("CLIENT_IP_HEADER") ?? DEFAULT_CLIENT_IP_HEADER).toLowerCase();
  if (!HEADER_SHAPE.test(clientIpHeader) || CREDENTIAL_HEADERS.has(clientIpHeader)) {
    fail("CLIENT_IP_HEADER", "must be the name of the header your platform sets to the client address");
  }

  const trustedProxies: string[] = [];
  for (const entry of (read("TRUSTED_PROXIES") ?? "").split(",")) {
    const proxy = entry.trim();
    if (!proxy) continue;
    if (!isAddressOrRange(proxy)) {
      fail("TRUSTED_PROXIES", "must be a comma-separated list of IP addresses or CIDR ranges");
    } else trustedProxies.push(proxy);
  }

  if (problems.length > 0 || !stage || !emailTransport) throw new EnvError(problems);

  return {
    stage,
    baseUrl,
    commitSha,
    databaseUrl,
    databaseUrlUnpooled: databaseUrlUnpooled || databaseUrl,
    authSecret,
    jobsTickSecret,
    adminEmails,
    emailTransport,
    mailboxSecret: mailboxSecret || null,
    signupAccessCode,
    operatorName,
    capacity,
    clientIpHeader,
    trustedProxies,
  };
}

type Read = (name: string) => string | null;
type Fail = (name: string, reason: string) => void;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** An IPv4 or IPv6 address, optionally followed by a prefix length that fits the family. */
function isAddressOrRange(value: string): boolean {
  const slash = value.indexOf("/");
  const family = isIP(slash === -1 ? value : value.slice(0, slash));
  if (family === 0) return false;
  if (slash === -1) return true;
  const prefix = value.slice(slash + 1);
  return /^[0-9]{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

function readPostgresUrl(name: string, read: Read, fail: Fail, required: boolean): string {
  const value = read(name);
  if (!value) {
    if (required) fail(name, "is required");
    return "";
  }
  const parsed = parseUrl(value);
  if (!parsed || (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:")) {
    fail(name, "must be a postgres connection URL");
    return "";
  }
  return value;
}

function readSecret(name: string, read: Read, fail: Fail, required: boolean): string {
  const value = read(name);
  if (!value) {
    if (required) fail(name, `is required and must be at least ${SECRET_MIN} characters`);
    return "";
  }
  if (value.length < SECRET_MIN) {
    fail(name, `must be at least ${SECRET_MIN} characters`);
    return "";
  }
  return value;
}

function readCount(name: string, fallback: number, read: Read, fail: Fail): number {
  const value = read(name);
  if (!value) return fallback;
  if (!/^[0-9]{1,15}$/.test(value) || Number(value) < 1) {
    fail(name, "must be a positive integer");
    return fallback;
  }
  return Number(value);
}

let cached: Env | undefined;

/** Validated lazily so importing this module (and `next build`) needs no runtime secrets. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Drop the cached configuration so the next getEnv() reads process.env again. */
export function resetEnvForTests(): void {
  cached = undefined;
}
