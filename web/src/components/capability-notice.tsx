import Link from "next/link";

import { IDENTITY_SOURCE } from "./capability-copy";
import { Notice } from "./ui/notice";

/**
 * The standing notice on the dashboard and on every profile page.
 * The wording follows "Wording rules for the interface" in docs/web/capability-matrix.md.
 * Change it there first. The statement about Instagram is shared with the landing page and the terms.
 */
export function CapabilityNotice({ className }: { className?: string }) {
  return (
    <Notice
      tone="info"
      title="Automatic identity tracking is unavailable."
      className={className}
      actions={
        <Link href="/#cannot-do" className="od-link inline-block py-1 text-sm">
          What OrbitDiff Web cannot do
        </Link>
      }
    >
      <p>
        {IDENTITY_SOURCE} OrbitDiff Web works from the exports you import. A difference between two exports is an
        observation in your exports, not a live follow or unfollow. A count change is a net change and never names
        accounts.
      </p>
    </Notice>
  );
}
