import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { htmlToText } from "../../components/support/render";

/**
 * The router a client component asks for with useRouter(). It exists only
 * inside a running app, so a test hands in one that does nothing: rendering
 * markup never calls it.
 */
const ROUTER: AppRouterInstance = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "test",
};

/** Static markup of a workspace screen, as the server would send it. */
export function renderScreen(screen: ReactNode): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: ROUTER }, screen));
}

/** The words a reader of that screen sees. */
export function screenText(screen: ReactNode): string {
  return htmlToText(renderScreen(screen));
}

/** The text of every badge in the markup, in order. A badge is the one pill-shaped span of the interface. */
export function badgeTexts(html: string): string[] {
  return [...html.matchAll(/<span class="[^"]*\brounded-full\b[^"]*">([\s\S]*?)<\/span>/g)].map((match) =>
    htmlToText(match[1] ?? ""),
  );
}

/** The text of every standing notice in the markup, in order: its label, its title, then what it says. */
export function noticeTexts(html: string): string[] {
  return [...html.matchAll(/<div role="note"[^>]*>([\s\S]*?)<\/div>/g)].map((match) => htmlToText(match[1] ?? ""));
}
