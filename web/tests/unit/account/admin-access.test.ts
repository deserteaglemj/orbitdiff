import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { metadata as notFoundMetadata } from "@/app/not-found";
import { adminMetadata } from "@/components/admin/page-metadata";
import {
  isProtectedPath,
  ONBOARDING_PATH,
  signInRedirect,
  VERIFY_EMAIL_PATH,
} from "@/server/auth/paths";

/**
 * Who gets which answer on /admin, and what the page is titled.
 *
 * The page function answers not found to everyone but the admin. A full page
 * load is answered earlier for some visitors, by the proxy and by the
 * signed-in layout. These tests pin the title rule, and they pin the written
 * rule in docs/web/interface.md to the code that decides it, so the page, its
 * comments, and the reference cannot drift apart again.
 */

describe("adminMetadata: the title of the admin page", () => {
  it("titles the page Admin for the admin and keeps it out of search results", () => {
    expect(adminMetadata("admin")).toEqual({ title: "Admin", robots: { index: false, follow: false } });
  });

  it("gives a visitor the page answers with not found the title of the not-found page, and nothing else", () => {
    expect(adminMetadata("other")).toEqual({ title: notFoundMetadata.title });
  });

  it("titles the suspended notice as what it is: not Admin, and not the not-found page", () => {
    const { title } = adminMetadata("suspended");
    expect(title).toBe("Account suspended");
    expect(title).not.toBe(notFoundMetadata.title);
    expect(String(title)).not.toMatch(/admin/i);
  });

  it("fails closed: a visitor it does not know gets the not-found title, never Admin", () => {
    for (const unknown of ["operator", "ADMIN", "", undefined, null, true]) {
      expect(adminMetadata(unknown as never)).toEqual({ title: notFoundMetadata.title });
    }
  });
});

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** The text of the section whose heading starts with this, up to the next section. Empty when there is none. */
function docSection(doc: string, heading: string): string {
  const start = doc.indexOf(`\n## ${heading}`);
  if (start === -1) return "";
  const next = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, next === -1 ? undefined : next);
}

/** The table row whose first cell starts with this. Empty when there is none. */
function tableRow(section: string, firstCell: string): string {
  return section.split("\n").find((line) => line.startsWith(`| ${firstCell}`)) ?? "";
}

describe("docs/web/interface.md: who gets which answer on /admin", () => {
  const section = docSection(read("../../../../docs/web/interface.md"), "11. ");

  it("has the section, and says which earlier sentences it replaces", () => {
    expect(section).toContain("`/admin`: who gets which answer");
    expect(section).toContain("section 4");
    expect(section).toContain("section 9");
  });

  it("says the proxy sends a visitor without a session cookie to sign-in, which is what the proxy does", () => {
    const destination = signInRedirect({ pathname: "/admin", search: "", hasSession: false });
    expect(isProtectedPath("/admin")).toBe(true);
    expect(destination).toBe("/sign-in?next=%2Fadmin");
    const row = tableRow(section, "No session cookie");
    expect(row).toContain("proxy");
    expect(row).toContain(`\`${destination}\``);
  });

  it("says the proxy lets a request with a session cookie through, so the layout answers a cookie that is no session", () => {
    expect(signInRedirect({ pathname: "/admin", search: "", hasSession: true })).toBeNull();
    const row = tableRow(section, "A session cookie that is not a valid session");
    expect(row).toContain("layout");
    expect(row).toContain("`/sign-in?next=%2Fadmin`");
  });

  it("says the layout sends an address that is not verified to the verify page", () => {
    const row = tableRow(section, "Signed in, address not verified");
    expect(row).toContain("layout");
    expect(row).toContain(`\`${VERIFY_EMAIL_PATH}\``);
  });

  it("says a suspended account sees the suspended notice, under the title the page gives it", () => {
    const row = tableRow(section, "Signed in, suspended");
    expect(row).toContain("layout");
    expect(row).toContain("suspended notice");
    expect(row).toContain(`"${String(adminMetadata("suspended").title)}"`);
    expect(row).not.toContain("404");
  });

  it("says the layout sends an account that is not onboarded to onboarding, the admin included", () => {
    const row = tableRow(section, "Signed in, not onboarded");
    expect(row).toContain("layout");
    expect(row).toContain("the admin included");
    expect(row).toContain(`\`${ONBOARDING_PATH}\``);
  });

  it("limits the 404 to a signed-in, verified, active, onboarded account that is not the admin", () => {
    const rows = section.split("\n").filter((line) => line.startsWith("| ") && line.includes("404"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^\| Signed in, verified, active, onboarded, not the admin \|/);
    expect(rows[0]).toContain("page");
    expect(rows[0]).toContain(`"${String(notFoundMetadata.title)}"`);
  });

  it("says the admin routes of the API answer 404 to everyone else, signed in or not", () => {
    expect(section).toMatch(/`\/api\/admin\/\*`[^\n]*404 to everyone but the admin, signed in or not/);
  });
});

describe("the admin page", () => {
  /** The source without comments, so a rule that is only mentioned in a comment does not count. */
  const source = read("../../../src/app/(app)/admin/page.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("takes every title from adminMetadata and writes none of its own", () => {
    expect(source).toContain('adminMetadata("admin")');
    expect(source).toContain('"suspended"');
    expect(source).not.toMatch(/\btitle\s*:/);
    expect(source).not.toMatch(/export\s+const\s+metadata\b/);
  });

  it("asks the signed-in layout's own decision for whether the suspended notice is shown", () => {
    expect(source).toMatch(/resolvePageAccess\(/);
    expect(source).toMatch(/\.kind\s*===\s*"suspended"/);
  });

  it("still answers not found itself, for every request that does not pass requireAdmin", () => {
    expect(source).toMatch(/requireAdmin\(/);
    expect(source).toMatch(/notFound\(\)/);
  });
});
