import { TextLink } from "@/components/auth/auth-parts";
import { Badge } from "@/components/ui";
import type { ConsentStateDto } from "@/server/services/contracts";

import { documentConsentSummary, type DocumentKind } from "./consent-summary";

const DOCUMENTS: Record<DocumentKind, { name: string; href: string; link: string }> = {
  terms: { name: "Terms", href: "/legal/terms", link: "Read the Terms" },
  privacy: { name: "Privacy notice", href: "/legal/privacy", link: "Read the Privacy notice" },
};

const KINDS: readonly DocumentKind[] = ["terms", "privacy"];

/**
 * The recorded acceptance of the Terms and of the Privacy notice: the version,
 * the time, and whether it is still the current version. Read only. There is
 * no control here, because nothing on this page changes these records.
 */
export function ConsentRecord({
  consent,
  versions,
  timeZone,
}: {
  consent: ConsentStateDto;
  versions: { terms: string; privacy: string };
  timeZone: string;
}) {
  return (
    <div className="grid gap-4">
      <dl className="grid gap-3">
        {KINDS.map((kind) => {
          const summary = documentConsentSummary(kind, consent[kind], versions[kind], timeZone);
          const document = DOCUMENTS[kind];
          return (
            <div key={kind} className="rounded-lg border border-line px-4 py-3">
              <dt className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-ink">{document.name}</span>
                <Badge tone={summary.tone}>{summary.badge}</Badge>
              </dt>
              <dd className="mt-1 text-sm text-ink">
                <p>{summary.text}</p>
                <p className="mt-1">
                  <TextLink href={document.href}>{document.link}</TextLink>
                </p>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="max-w-[65ch] text-sm text-muted">
        These records cannot be changed on this page. When a document changes, OrbitDiff Web asks you to read and accept
        the new version before you continue. Product news is a separate choice, recorded under Communication.
      </p>
    </div>
  );
}
