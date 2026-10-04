import { afterEach, describe, expect, it, vi } from "vitest";

import { runInBackground, settleBackground } from "@/server/http/background";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("background work", () => {
  it("does not block the caller and can be awaited to completion", async () => {
    let finished = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    runInBackground(
      gate.then(() => {
        finished = true;
      }),
    );
    expect(finished).toBe(false);
    release();
    await settleBackground();
    expect(finished).toBe(true);
  });

  it("logs a failed task once, redacted, and never rejects", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    runInBackground(Promise.reject(new Error("could not reach nova@orbitdiff.test")));
    await expect(settleBackground()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]?.join(" ")).not.toContain("nova@orbitdiff.test");
  });

  it("waits for work that was queued by other background work", async () => {
    const order: string[] = [];
    runInBackground(
      Promise.resolve().then(() => {
        order.push("first");
        runInBackground(Promise.resolve().then(() => void order.push("second")));
      }),
    );
    await settleBackground();
    expect(order).toEqual(["first", "second"]);
  });
});
