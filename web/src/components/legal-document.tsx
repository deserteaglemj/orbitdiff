import type { ReactNode } from "react";

import { Container } from "./page-frame";
import { formatDate } from "./ui/format";

export interface LegalSection {
  /** Anchor id, used by the contents list. */
  id: string;
  title: string;
  body: ReactNode;
}

export interface LegalDocumentProps {
  title: string;
  /** The consent version from CONSENT_VERSIONS. It is the date the text last changed. */
  version: string;
  /** One paragraph that says what the document covers. */
  summary: ReactNode;
  sections: LegalSection[];
}

/** Layout for the privacy notice and the terms: title, version, contents, then the sections. */
export function LegalDocument({ title, version, summary, sections }: LegalDocumentProps) {
  return (
    <Container className="py-10 sm:py-14">
      <header className="od-prose">
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h1>
        <p className="text-sm text-muted">
          Version {version}. Last changed on {formatDate(`${version}T00:00:00Z`)}.
        </p>
        <p className="text-lg text-ink">{summary}</p>
      </header>
      <div className="mt-10 grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="On this page" className="self-start lg:sticky lg:top-6">
          <h2 className="text-sm font-semibold text-ink">On this page</h2>
          <ol className="mt-3 grid gap-1 text-sm">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex min-h-8 items-center rounded-md text-muted underline-offset-4 hover:text-ink hover:underline"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="od-prose">
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={section.id}>
              <h2 id={section.id}>{section.title}</h2>
              {section.body}
            </section>
          ))}
        </div>
      </div>
    </Container>
  );
}
