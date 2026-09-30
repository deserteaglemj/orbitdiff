import { DomainError, MESSAGES } from "./errors";

/** Same pattern as `personal._HANDLE`: ASCII only, 1 to 30 characters, not dots alone. */
const HANDLE = /^(?!\.+$)[A-Za-z0-9._]{1,30}$/;

/**
 * Equal to `personal._handle`: full match first, then lowercase.
 * No trimming and no `@` removal; anything else is rejected.
 */
export function normalizeHandle(value: unknown): string {
  if (typeof value !== "string" || !HANDLE.test(value)) {
    throw new DomainError("invalid_handle", MESSAGES.handle);
  }
  return value.toLowerCase();
}

const EDGE_SPACE = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;
const LINK = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/;
const HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const POST_ROOTS = new Set(["p", "reel", "reels", "tv"]);
const OTHER_ROOTS = new Set(["explore", "accounts", "direct"]);

export const PROFILE_INPUT_MESSAGES = {
  notALink:
    "Enter an Instagram username or a profile link such as https://www.instagram.com/atlas_studio/.",
  wrongHost: "Only profile links on instagram.com are accepted.",
  authority: "Profile links with a port or sign-in details are not accepted.",
  post: "That link points to a post or reel. Enter the profile link or the username instead.",
  story: "That link points to a story. Enter the profile link or the username instead.",
  notAProfile: "That link is not a profile. Enter the profile link or the username instead.",
  segments:
    "A profile link must contain exactly one username, for example https://www.instagram.com/atlas_studio/.",
} as const;

function refuse(message: string): never {
  throw new DomainError("invalid_profile_url", message);
}

/**
 * The add-profile form value: a handle, or an Instagram profile link with one
 * path segment. The query and fragment of a link are discarded. Nothing is
 * guessed from a post, reel, story, or unrelated link.
 */
export function parseProfileInput(value: unknown): string {
  if (typeof value !== "string") {
    throw new DomainError("invalid_handle", MESSAGES.handle);
  }
  let text = value.replace(EDGE_SPACE, "");
  if (text.startsWith("@")) {
    text = text.slice(1);
  }
  if (!/[/:\\]/.test(text)) {
    return normalizeHandle(text);
  }
  const link = LINK.exec(text);
  if (link === null) {
    return refuse(PROFILE_INPUT_MESSAGES.notALink);
  }
  const scheme = link[1].toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return refuse(PROFILE_INPUT_MESSAGES.notALink);
  }
  const authority = link[2];
  if (authority.includes("@") || authority.includes(":")) {
    return refuse(PROFILE_INPUT_MESSAGES.authority);
  }
  if (!HOSTS.has(authority.toLowerCase())) {
    return refuse(PROFILE_INPUT_MESSAGES.wrongHost);
  }
  const segments = link[3].split("/").slice(1);
  if (segments.length > 0 && segments[segments.length - 1] === "") {
    segments.pop();
  }
  const root = (segments[0] ?? "").toLowerCase();
  if (POST_ROOTS.has(root)) {
    return refuse(PROFILE_INPUT_MESSAGES.post);
  }
  if (root === "stories") {
    return refuse(PROFILE_INPUT_MESSAGES.story);
  }
  if (OTHER_ROOTS.has(root)) {
    return refuse(PROFILE_INPUT_MESSAGES.notAProfile);
  }
  if (segments.length !== 1 || segments[0] === "") {
    return refuse(PROFILE_INPUT_MESSAGES.segments);
  }
  return normalizeHandle(segments[0]);
}
