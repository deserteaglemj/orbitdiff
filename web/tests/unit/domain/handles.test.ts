import { describe, expect, it } from "vitest";

import { DomainError } from "@/domain/errors";
import { parseProfileInput } from "@/domain/handles";

function failure(value: unknown): DomainError {
  try {
    parseProfileInput(value);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }
  throw new Error("expected parseProfileInput to reject");
}

describe("parseProfileInput", () => {
  it.each([
    ["atlas_studio", "atlas_studio"],
    ["Atlas_Studio", "atlas_studio"],
    ["  atlas_studio \n", "atlas_studio"],
    ["@atlas_studio", "atlas_studio"],
    [" @Nova_Labs ", "nova_labs"],
    ["https://www.instagram.com/atlas_studio", "atlas_studio"],
    ["https://www.instagram.com/atlas_studio/", "atlas_studio"],
    ["https://instagram.com/atlas_studio/", "atlas_studio"],
    ["http://instagram.com/atlas_studio", "atlas_studio"],
    ["HTTPS://WWW.INSTAGRAM.COM/Atlas_Studio/", "atlas_studio"],
    ["https://www.instagram.com/atlas_studio/?hl=en", "atlas_studio"],
    ["https://www.instagram.com/atlas_studio?igsh=abc#top", "atlas_studio"],
    ["https://www.instagram.com/atlas_studio/#", "atlas_studio"],
    ["\thttps://www.instagram.com/pixel_forge/ ", "pixel_forge"],
  ])("accepts %j", (input, expected) => {
    expect(parseProfileInput(input)).toBe(expected);
  });

  it.each([
    ["", "invalid_handle"],
    ["   ", "invalid_handle"],
    ["@", "invalid_handle"],
    ["@@atlas_studio", "invalid_handle"],
    ["atlas studio", "invalid_handle"],
    ["bad-name", "invalid_handle"],
    ["...", "invalid_handle"],
    ["a".repeat(31), "invalid_handle"],
    [" atlas_studio", "invalid_handle"],
    [42, "invalid_handle"],
    [null, "invalid_handle"],
    ["https://www.instagram.com/", "invalid_profile_url"],
    ["https://www.instagram.com", "invalid_profile_url"],
    ["https://www.instagram.com//atlas_studio", "invalid_profile_url"],
    ["https://www.instagram.com/atlas_studio//", "invalid_profile_url"],
    ["https://www.instagram.com/atlas_studio/followers/", "invalid_profile_url"],
    ["https://www.instagram.com/_u/atlas_studio", "invalid_profile_url"],
    ["https://www.instagram.com/bad-name/", "invalid_handle"],
    ["https://www.instagram.com/%61tlas/", "invalid_handle"],
    ["https://m.instagram.com/atlas_studio", "invalid_profile_url"],
    ["https://instagram.com.example.org/atlas_studio", "invalid_profile_url"],
    ["https://example.org/atlas_studio", "invalid_profile_url"],
    ["https://www.instagram.com:443/atlas_studio", "invalid_profile_url"],
    ["https://user@www.instagram.com/atlas_studio", "invalid_profile_url"],
    ["https://www.instagram.com@example.org/atlas_studio", "invalid_profile_url"],
    ["ftp://www.instagram.com/atlas_studio", "invalid_profile_url"],
    ["//www.instagram.com/atlas_studio", "invalid_profile_url"],
    ["www.instagram.com/atlas_studio", "invalid_profile_url"],
    ["instagram.com/atlas_studio", "invalid_profile_url"],
    ["https:/www.instagram.com/atlas_studio", "invalid_profile_url"],
    ["https://www.instagram.com\\atlas_studio", "invalid_profile_url"],
    ["javascript:alert(1)", "invalid_profile_url"],
  ])("rejects %j with %s", (input, code) => {
    expect(failure(input).code).toBe(code);
  });

  it("names a post link", () => {
    const error = failure("https://www.instagram.com/p/CxYz123/");
    expect(error.code).toBe("invalid_profile_url");
    expect(error.message).toMatch(/post or reel/);
  });

  it.each([
    "https://www.instagram.com/reel/CxYz123/",
    "https://www.instagram.com/reels/CxYz123/",
    "https://www.instagram.com/tv/CxYz123/",
    "https://www.instagram.com/p/",
    "https://www.instagram.com/reels",
  ])("names a post or reel link for %s", (input) => {
    expect(failure(input).message).toMatch(/post or reel/);
  });

  it.each([
    "https://www.instagram.com/stories/atlas_studio/31415/",
    "https://www.instagram.com/stories/atlas_studio",
    "https://www.instagram.com/stories/",
  ])("names a story link for %s", (input) => {
    const error = failure(input);
    expect(error.code).toBe("invalid_profile_url");
    expect(error.message).toMatch(/story/);
  });

  it.each(["explore", "accounts", "direct"])("rejects the reserved path %s", (segment) => {
    expect(failure(`https://www.instagram.com/${segment}/`).code).toBe("invalid_profile_url");
  });

  it("never asks for credentials in its messages", () => {
    for (const input of ["https://example.org/x", "https://www.instagram.com/p/1/", "bad-name"]) {
      expect(failure(input).message).not.toMatch(/password|cookie|session|code/i);
    }
  });
});
