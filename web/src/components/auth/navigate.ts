/**
 * Load a page of this app with a full navigation.
 *
 * The account screens use this after the login state changed (signed in, signed
 * out, signed up, password reset, onboarding finished). A full load makes the
 * server render the next page from the start with the new state, and leaves
 * nothing in the client router cache that was rendered for the old one.
 *
 * `path` must be a path on this site. Callers pass a constant or the result of
 * afterSignInPath(), which only returns site paths.
 */
export function loadPage(path: string): void {
  window.location.assign(path);
}
