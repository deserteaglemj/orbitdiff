"use client";

import { useState } from "react";

import { SectionHeading } from "@/components/ui";

import { PasswordForm } from "./password-form";
import { SessionsPanel } from "./sessions-panel";

/**
 * The Security section: the password form, then the logins. A password change
 * signs every other device out, so the list of devices is read again after it.
 */
export function SecuritySection({ email, name, timeZone }: { email: string; name: string; timeZone: string }) {
  // A new key mounts the list again, which makes it ask the server for the current logins.
  const [generation, setGeneration] = useState(0);
  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <SectionHeading level={3} title="Change password" />
        <PasswordForm email={email} name={name} onChanged={() => setGeneration((count) => count + 1)} />
      </div>
      <div className="grid gap-4 border-t border-line pt-6">
        <SectionHeading
          level={3}
          title="Signed-in devices"
          description="Each entry is a login to your OrbitDiff account. Sign out a device you do not recognize, then change your password."
        />
        <SessionsPanel key={generation} timeZone={timeZone} />
      </div>
    </div>
  );
}
