"use client";

import { useEffect, useState, type RefObject } from "react";

import { createFocusRequest, focusTarget, type FocusRoot, type FocusTarget } from "./focus-request";

/**
 * Focus for a form that disables its fields while a request runs.
 *
 * Call the returned function from the submit handler to say where focus should
 * go: `fieldTarget(name)` for a field with an error, `SUBMIT_TARGET` for a
 * failure that belongs to no field. Focus moves after the render in which
 * `controlsEnabled` is true, that is, once the fields can take focus again and
 * the error text is in the document, so it is read out with the field. Calling
 * `focus()` from the handler itself would do nothing: the fields are still
 * disabled at that moment.
 *
 * Pass `!pending` as `controlsEnabled`.
 */
export function useFocusAfterSubmit(
  form: RefObject<FocusRoot | null>,
  controlsEnabled: boolean,
): (target: FocusTarget) => void {
  const [request] = useState(createFocusRequest);
  const [, setAsked] = useState(0);
  // No dependency list on purpose: it runs after every render and does nothing unless a target is waiting.
  useEffect(() => {
    const target = request.take(controlsEnabled);
    if (target !== null) focusTarget(form.current, target);
  });
  return (target) => {
    request.ask(target);
    // A submit that fails the same way twice changes no other state. This makes sure a render follows.
    setAsked((count) => count + 1);
  };
}
