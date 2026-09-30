type Part = string | false | null | undefined;

/** Joins the class names that are present. */
export function cx(...parts: Part[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Builds an `aria-describedby` value from the ids that are present. */
export function describedBy(...ids: Part[]): string | undefined {
  const present = ids.filter(Boolean);
  return present.length > 0 ? present.join(" ") : undefined;
}

/** True when a link leaves the app, so it renders as a plain anchor instead of a router link. */
export function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}
