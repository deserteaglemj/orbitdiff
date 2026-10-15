"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

import { loadPage } from "./navigate";

/**
 * Ends the login on the server, then loads the sign-in page with a full
 * navigation so nothing rendered for the signed-in account stays on screen.
 */
export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut(): Promise<void> {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const { error } = await authClient.signOut();
      if (!error) {
        loadPage("/sign-in");
        return;
      }
    } catch {
      // Reported below.
    }
    setFailed(true);
    setPending(false);
  }

  return (
    <>
      <Button variant="secondary" onClick={signOut} loading={pending} loadingLabel="Signing out">
        {failed ? "Try signing out again" : "Sign out"}
      </Button>
      <span role="status" className="sr-only">
        {failed ? "Signing out did not work. You are still signed in." : ""}
      </span>
    </>
  );
}
