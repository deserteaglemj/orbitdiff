import Link from "next/link";

import { LogoMark } from "./logo";
import { Container } from "./page-frame";

export const REPOSITORY_URL = "https://github.com/deserteaglemj/orbitdiff";

const LINK = "inline-flex min-h-10 items-center rounded-lg text-sm text-muted underline-offset-4 hover:text-ink hover:underline";

/** Footer for public pages. Every link leads to a page that exists. */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <Container className="grid gap-8 py-10 md:grid-cols-[minmax(0,1fr)_auto_auto] md:gap-16">
        <div className="max-w-md">
          <p className="flex items-center gap-2 font-bold text-ink">
            <LogoMark size={24} />
            OrbitDiff <span className="font-normal text-muted">Web</span>
          </p>
          <p className="mt-3 text-sm text-muted">
            A free, non-commercial preview that works from the Instagram exports you import. Not affiliated with
            Instagram or Meta.
          </p>
        </div>
        <nav aria-label="Account and product">
          <ul>
            <li>
              <Link href="/sign-up" className={LINK}>
                Create account
              </Link>
            </li>
            <li>
              <Link href="/sign-in" className={LINK}>
                Sign in
              </Link>
            </li>
            <li>
              <a href={REPOSITORY_URL} rel="noopener noreferrer" className={LINK}>
                Local app and skill on GitHub
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label="Legal">
          <ul>
            <li>
              <Link href="/legal/privacy" className={LINK}>
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/legal/terms" className={LINK}>
                Terms
              </Link>
            </li>
          </ul>
        </nav>
      </Container>
    </footer>
  );
}
