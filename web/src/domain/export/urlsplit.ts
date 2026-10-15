import { DomainError } from "../errors";

/**
 * A hand port of `urllib.parse.urlsplit` (CPython 3.13) for text input.
 *
 * `new URL()` is not used: it drops default ports, lowercases and normalizes
 * the host, percent-encodes the path, and rejects inputs Python splits without
 * complaint. The row rules compare the raw pieces, so the split must be the
 * same split.
 *
 * One deliberate gap: Python validates the text between brackets in a host
 * with `ipaddress` and reports that module's wording. Here the brackets are
 * checked for placement only. A bracketed host can never be an Instagram
 * host, so such a row is rejected on both sides, with different wording.
 */
export interface SplitUrl {
  scheme: string;
  netloc: string;
  path: string;
  query: string;
  fragment: string;
}

const LEADING_C0_OR_SPACE = /^[\u0000- ]+/;
const TAB_OR_NEWLINE = /[\t\r\n]/g;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;
const FUTURE_ADDRESS = /^v[a-fA-F0-9]+\.[^\n]+$/;
const ASCII_ONLY = /^[\u0000-\u007f]*$/;

function refuse(message: string): never {
  throw new DomainError("malformed_row", message);
}

function checkBracketedNetloc(netloc: string): void {
  const hostAndPort = netloc.slice(netloc.lastIndexOf("@") + 1);
  const open = hostAndPort.indexOf("[");
  let hostname: string;
  if (open >= 0) {
    if (open > 0) {
      refuse("Invalid IPv6 URL");
    }
    const bracketed = hostAndPort.slice(1);
    const close = bracketed.indexOf("]");
    hostname = close >= 0 ? bracketed.slice(0, close) : bracketed;
    const port = close >= 0 ? bracketed.slice(close + 1) : "";
    if (port !== "" && !port.startsWith(":")) {
      refuse("Invalid IPv6 URL");
    }
  } else {
    const colon = hostAndPort.indexOf(":");
    hostname = colon >= 0 ? hostAndPort.slice(0, colon) : hostAndPort;
  }
  if (hostname.startsWith("v") && !FUTURE_ADDRESS.test(hostname)) {
    refuse("IPvFuture address is invalid");
  }
}

function checkNetloc(netloc: string): void {
  if (netloc === "" || ASCII_ONLY.test(netloc)) {
    return;
  }
  const stripped = netloc.replace(/[@:#?]/g, "");
  const normalized = stripped.normalize("NFKC");
  if (stripped === normalized) {
    return;
  }
  if (/[/?#@:]/.test(normalized)) {
    refuse(`netloc '${netloc}' contains invalid characters under NFKC normalization`);
  }
}

export function urlSplit(input: string): SplitUrl {
  let url = input.replace(LEADING_C0_OR_SPACE, "").replace(TAB_OR_NEWLINE, "");
  let scheme = "";
  let netloc = "";
  let query = "";
  let fragment = "";
  const colon = url.indexOf(":");
  if (colon > 0 && SCHEME.test(url.slice(0, colon))) {
    scheme = url.slice(0, colon).toLowerCase();
    url = url.slice(colon + 1);
  }
  if (url.startsWith("//")) {
    let end = url.length;
    for (const delimiter of "/?#") {
      const found = url.indexOf(delimiter, 2);
      if (found >= 0) {
        end = Math.min(end, found);
      }
    }
    netloc = url.slice(2, end);
    url = url.slice(end);
    const opens = netloc.includes("[");
    const closes = netloc.includes("]");
    if (opens !== closes) {
      refuse("Invalid IPv6 URL");
    }
    if (opens && closes) {
      checkBracketedNetloc(netloc);
    }
  }
  const hash = url.indexOf("#");
  if (hash >= 0) {
    fragment = url.slice(hash + 1);
    url = url.slice(0, hash);
  }
  const mark = url.indexOf("?");
  if (mark >= 0) {
    query = url.slice(mark + 1);
    url = url.slice(0, mark);
  }
  checkNetloc(netloc);
  return { scheme, netloc, path: url, query, fragment };
}
