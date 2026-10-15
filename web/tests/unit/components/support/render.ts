import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Static markup of a component that takes no props, as the server would send it. */
export function renderHtml(component: ComponentType): string {
  return renderToStaticMarkup(createElement(component));
}

const BLOCK_END = /<\/(?:p|li|dt|dd|h[1-6]|div|section|figcaption|td|th|tr)>/g;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
};

/** The words a reader sees: tags removed, entities decoded, whitespace collapsed to single spaces. */
export function htmlToText(html: string): string {
  return html
    .replace(BLOCK_END, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, " ")
    .trim();
}

/** The text of one section of a LegalDocument, found by its anchor id. */
export function sectionText(html: string, id: string): string {
  const open = `<section aria-labelledby="${id}">`;
  const start = html.indexOf(open);
  if (start === -1) {
    throw new Error(`no section with id ${id}`);
  }
  const end = html.indexOf("</section>", start);
  return htmlToText(html.slice(start + open.length, end));
}
