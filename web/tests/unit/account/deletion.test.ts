import { describe, expect, it } from "vitest";

import { buildDeletionRequest, deleteAccount, type DeleteUserCall } from "@/components/settings/deletion";

const PASSWORD = "copper lantern orbit";
const ASK = "Enter your password to delete your account.";

/** Stands in for authClient.deleteUser and records what it was sent. */
function recorder(answer: Awaited<ReturnType<DeleteUserCall>> | Error = { data: { success: true }, error: null }) {
  const sent: unknown[] = [];
  const call: DeleteUserCall = async (body) => {
    sent.push(body);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { call, sent };
}

describe("buildDeletionRequest: the confirmation fails closed", () => {
  it("builds a request that holds the password and nothing else", () => {
    const request = buildDeletionRequest(PASSWORD);
    expect(request).toEqual({ ok: true, body: { password: PASSWORD } });
    expect(request.ok && Object.keys(request.body)).toEqual(["password"]);
  });

  it("keeps the password exactly as typed, spaces included", () => {
    expect(buildDeletionRequest("  spaced out pass  ")).toEqual({ ok: true, body: { password: "  spaced out pass  " } });
  });

  it("refuses a missing password", () => {
    expect(buildDeletionRequest(undefined)).toEqual({ ok: false, error: ASK });
  });

  it("refuses a null password", () => {
    expect(buildDeletionRequest(null)).toEqual({ ok: false, error: ASK });
  });

  it("refuses an empty password", () => {
    expect(buildDeletionRequest("")).toEqual({ ok: false, error: ASK });
  });

  it.each([
    ["the boolean true", true],
    ["a number", 1234567890],
    ["an object", { password: PASSWORD }],
    ["a list", [PASSWORD]],
  ])("refuses a password that is %s", (_label, value) => {
    const request = buildDeletionRequest(value);
    expect(request).toEqual({ ok: false, error: ASK });
    expect(request).not.toHaveProperty("body");
  });
});

describe("deleteAccount", () => {
  it("sends the password and reports the account as deleted when the server confirms it", async () => {
    const { call, sent } = recorder({ data: { success: true, message: "User deleted" }, error: null });
    expect(await deleteAccount(call, PASSWORD)).toEqual({ kind: "deleted" });
    expect(sent).toEqual([{ password: PASSWORD }]);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["not text", 42],
  ])("sends nothing at all when the password is %s", async (_label, password) => {
    const { call, sent } = recorder();
    expect(await deleteAccount(call, password)).toEqual({ kind: "password", message: ASK });
    expect(sent).toEqual([]);
  });

  it("puts a wrong password on the password field, with the server's own message", async () => {
    const { call } = recorder({ data: null, error: { status: 400, code: "INVALID_PASSWORD", message: "Invalid password" } });
    expect(await deleteAccount(call, "not the password")).toEqual({
      kind: "password",
      message: "Invalid password. Your account was not deleted.",
    });
  });

  it("puts the server's password requirement on the password field", async () => {
    const message = "Enter your password to delete your account.";
    const { call } = recorder({ data: null, error: { status: 400, code: "PASSWORD_REQUIRED", message } });
    expect(await deleteAccount(call, PASSWORD)).toEqual({
      kind: "password",
      message: `${message} Your account was not deleted.`,
    });
  });

  it("shows any other refusal with the server's own message", async () => {
    const { call } = recorder({
      data: null,
      error: { status: 403, code: "ACCOUNT_SUSPENDED", message: "This account is suspended." },
    });
    expect(await deleteAccount(call, PASSWORD)).toEqual({
      kind: "refused",
      message: "This account is suspended. Your account was not deleted.",
    });
  });

  it("reads the application envelope as well", async () => {
    const { call } = recorder({
      data: null,
      error: { status: 403, error: { code: "forbidden_origin", message: "This request came from another site." } },
    });
    expect(await deleteAccount(call, PASSWORD)).toEqual({
      kind: "refused",
      message: "This request came from another site. Your account was not deleted.",
    });
  });

  it("says to wait when the server limits the attempts", async () => {
    const { call } = recorder({ data: null, error: { status: 429, message: "Too many requests." } });
    expect(await deleteAccount(call, PASSWORD)).toEqual({
      kind: "refused",
      message: "Too many attempts. Wait a minute, then try again. Your account was not deleted.",
    });
  });

  it("does not report a deletion when the request never reached the server", async () => {
    const { call } = recorder(new TypeError("fetch failed"));
    expect(await deleteAccount(call, PASSWORD)).toEqual({
      kind: "refused",
      message: "The request did not reach the server, so your account was not deleted. Check your connection and try again.",
    });
  });

  it.each([
    ["an answer with no data", { data: null, error: null }],
    ["an answer that is not a confirmation", { data: { success: false }, error: null }],
    ["a confirmation given as text", { data: { success: "true" }, error: null }],
    ["an empty answer", {}],
  ])("does not report a deletion for %s", async (_label, answer) => {
    const { call } = recorder(answer as Awaited<ReturnType<DeleteUserCall>>);
    expect(await deleteAccount(call, PASSWORD)).toEqual({
      kind: "refused",
      message: "The server did not confirm the deletion. Reload this page to see whether your account still exists.",
    });
  });
});
