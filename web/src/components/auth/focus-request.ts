/**
 * Where focus goes after a submit that did not succeed, and when.
 *
 * Every account form disables its fields while a request runs. A disabled
 * control cannot take focus, so a form must not move focus in the same tick in
 * which it learns of a refusal: the controls are still disabled in the document
 * at that moment, and the message under the field is not in it yet. The form
 * records where focus should go (`ask`) and moves it after the render that
 * enables the controls and shows the message (`take`, called after every
 * render by useFocusAfterSubmit).
 *
 * Pure functions with no React and no document, so the rule is tested directly.
 */
export type FocusTarget = { kind: "field"; name: string } | { kind: "submit" };

/** The submit button: for a failure that belongs to no field, so focus is not left on nothing. */
export const SUBMIT_TARGET: FocusTarget = { kind: "submit" };

/** The control with this `name` attribute. */
export function fieldTarget(name: string): FocusTarget {
  return { kind: "field", name };
}

export interface FocusRequest {
  /** Record where focus should go. A later call replaces a target that was not handed out yet. */
  ask(target: FocusTarget): void;
  /**
   * Call after every render with whether the controls are enabled. It returns
   * the recorded target once they are, exactly once, and null otherwise. A
   * target recorded while the controls are disabled is kept for a later render.
   */
  take(controlsEnabled: boolean): FocusTarget | null;
}

export function createFocusRequest(): FocusRequest {
  let wanted: FocusTarget | null = null;
  return {
    ask(target) {
      wanted = target;
    },
    take(controlsEnabled) {
      if (!controlsEnabled || wanted === null) return null;
      const target = wanted;
      wanted = null;
      return target;
    },
  };
}

/** The first field, in the order the fields appear on the screen, that has an error. */
export function firstFieldWithError<Field extends string>(
  order: readonly Field[],
  errors: Partial<Record<Field, string | undefined>>,
): Field | null {
  return order.find((field) => errors[field] !== undefined) ?? null;
}

/** The part of a form element this module uses. */
export interface FocusRoot {
  querySelector(selector: string): unknown;
}

const SUBMIT_SELECTOR = 'button[type="submit"]';
/** A name that can be written into an attribute selector as it is. */
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

interface Focusable {
  focus(): void;
  disabled?: unknown;
}

function usable(found: unknown): Focusable | null {
  if (typeof found !== "object" || found === null) return null;
  const candidate = found as Partial<Focusable>;
  if (typeof candidate.focus !== "function" || candidate.disabled === true) return null;
  return candidate as Focusable;
}

/**
 * Move focus to the target inside the form. A field that is not on the screen,
 * or that is still disabled, cannot take focus: the submit button takes it
 * instead, so focus is never left on the page body. Returns whether any
 * control took focus.
 */
export function focusTarget(root: FocusRoot | null | undefined, target: FocusTarget): boolean {
  if (!root) return false;
  const field =
    target.kind === "field" && FIELD_NAME.test(target.name) ? usable(root.querySelector(`[name="${target.name}"]`)) : null;
  const control = field ?? usable(root.querySelector(SUBMIT_SELECTOR));
  if (control === null) return false;
  control.focus();
  return true;
}
