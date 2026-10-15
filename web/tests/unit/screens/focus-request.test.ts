import { describe, expect, it } from "vitest";

import {
  createFocusRequest,
  fieldTarget,
  firstFieldWithError,
  focusTarget,
  SUBMIT_TARGET,
} from "@/components/auth/focus-request";

/**
 * The repository has no DOM test environment, so the rule is tested where it
 * lives: a request for focus that outlasts the render in which the controls
 * are still disabled. `take(enabled)` is what the forms call after each render.
 */
describe("createFocusRequest: focus moves after the render that enables the controls", () => {
  it("hands out nothing when nothing was asked", () => {
    const request = createFocusRequest();
    expect(request.take(true)).toBeNull();
    expect(request.take(false)).toBeNull();
  });

  it("hands out the target after the next render when the controls are enabled", () => {
    const request = createFocusRequest();
    request.ask(fieldTarget("email"));
    expect(request.take(true)).toEqual({ kind: "field", name: "email" });
  });

  it("keeps a request made while the controls are disabled until a render enables them", () => {
    const request = createFocusRequest();
    // The server refused a field while every control was still disabled for the request.
    request.ask(fieldTarget("accessCode"));
    expect(request.take(false)).toBeNull();
    expect(request.take(false)).toBeNull();
    expect(request.take(true)).toEqual({ kind: "field", name: "accessCode" });
  });

  it("hands a request out once, so a later render does not pull focus back", () => {
    const request = createFocusRequest();
    request.ask(SUBMIT_TARGET);
    expect(request.take(true)).toEqual({ kind: "submit" });
    expect(request.take(true)).toBeNull();
  });

  it("lets a later request replace one that was not handed out yet", () => {
    const request = createFocusRequest();
    request.ask(fieldTarget("name"));
    request.ask(fieldTarget("timezone"));
    expect(request.take(true)).toEqual({ kind: "field", name: "timezone" });
  });

  it("works when ask and take are passed around as plain functions", () => {
    const { ask, take } = createFocusRequest();
    ask(SUBMIT_TARGET);
    expect(take(true)).toEqual({ kind: "submit" });
  });
});

describe("firstFieldWithError: the first field in screen order, not in the order the errors were found", () => {
  const ORDER = ["name", "email", "password", "timezone"] as const;

  it("returns the first field on the screen that has an error", () => {
    expect(firstFieldWithError(ORDER, { timezone: "Choose a timezone.", email: "Enter your email address." })).toBe("email");
  });

  it("skips a field whose error is undefined", () => {
    expect(firstFieldWithError(ORDER, { name: undefined, password: "Use at least 10 characters." })).toBe("password");
  });

  it("returns null when no listed field has an error", () => {
    expect(firstFieldWithError(ORDER, {})).toBeNull();
  });
});

/** A stand-in for a form element: it answers querySelector for the controls it holds and records what was focused. */
function form(controls: Record<string, { disabled?: boolean }>) {
  const focused: string[] = [];
  const asked: string[] = [];
  const elements = new Map(
    Object.entries(controls).map(([selector, state]) => [
      selector,
      { disabled: state.disabled === true, focus: () => void focused.push(selector) },
    ]),
  );
  return {
    focused,
    asked,
    querySelector(selector: string) {
      asked.push(selector);
      return elements.get(selector) ?? null;
    },
  };
}

const SUBMIT = 'button[type="submit"]';

describe("focusTarget: where focus lands inside the form", () => {
  it("focuses the control with the name of the field", () => {
    const container = form({ '[name="email"]': {}, [SUBMIT]: {} });
    expect(focusTarget(container, fieldTarget("email"))).toBe(true);
    expect(container.focused).toEqual(['[name="email"]']);
  });

  it("focuses the submit button when a request failed without a field", () => {
    const container = form({ '[name="email"]': {}, [SUBMIT]: {} });
    expect(focusTarget(container, SUBMIT_TARGET)).toBe(true);
    expect(container.focused).toEqual([SUBMIT]);
  });

  it("falls back to the submit button when the field is not on the screen", () => {
    const container = form({ [SUBMIT]: {} });
    expect(focusTarget(container, fieldTarget("accessCode"))).toBe(true);
    expect(container.focused).toEqual([SUBMIT]);
  });

  it("never asks a disabled control to take focus, because that does nothing", () => {
    const container = form({ '[name="email"]': { disabled: true }, [SUBMIT]: {} });
    expect(focusTarget(container, fieldTarget("email"))).toBe(true);
    expect(container.focused).toEqual([SUBMIT]);
  });

  it("reports that nothing took focus when the form holds no usable control", () => {
    expect(focusTarget(form({}), fieldTarget("email"))).toBe(false);
    expect(focusTarget(form({ [SUBMIT]: { disabled: true } }), SUBMIT_TARGET)).toBe(false);
    expect(focusTarget(null, SUBMIT_TARGET)).toBe(false);
  });

  it("never builds a selector from a name that is not a plain field name", () => {
    const container = form({ [SUBMIT]: {} });
    expect(focusTarget(container, fieldTarget('x"], body, [y="'))).toBe(true);
    expect(container.asked).toEqual([SUBMIT]);
    expect(container.focused).toEqual([SUBMIT]);
  });
});
