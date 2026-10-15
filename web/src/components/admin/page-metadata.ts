import type { Metadata } from "next";

/**
 * Who a request for the admin page comes from, as far as the title goes:
 *
 * - `admin`: requireAdmin passed;
 * - `suspended`: the signed-in layout renders the suspended notice in place of
 *   the page, and the page's title still applies to it;
 * - `other`: everyone else. The page answers them with not found.
 */
export type AdminTitleVisitor = "admin" | "suspended" | "other";

/** The title of `src/app/not-found.tsx`. tests/unit/account/admin-access.test.ts keeps the two equal. */
const NOT_FOUND_TITLE = "Page not found";

/**
 * The title of the admin page. It follows what the visitor is shown, and only
 * the admin gets the word "Admin": a value this function does not know is
 * treated as `other`.
 */
export function adminMetadata(visitor: AdminTitleVisitor): Metadata {
  switch (visitor) {
    case "admin":
      return { title: "Admin", robots: { index: false, follow: false } };
    case "suspended":
      return { title: "Account suspended" };
    default:
      return { title: NOT_FOUND_TITLE };
  }
}
