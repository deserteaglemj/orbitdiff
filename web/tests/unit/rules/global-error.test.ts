import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import GlobalError from "@/app/global-error";

const SOURCE = path.resolve(import.meta.dirname, "../../../src/app/global-error.tsx");

type Props = { children?: ReactNode; onClick?: () => void };

/** Every element in a rendered tree, depth first. Function components are called, as React would. */
function elements(node: ReactNode, found: Array<ReactElement<Props>> = []): Array<ReactElement<Props>> {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found);
  } else if (isValidElement<Props>(node)) {
    found.push(node);
    elements(node.props.children, found);
  }
  return found;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<Props>(node) ? textOf(node.props.children) : "";
}

const failure = (digest?: string): Error & { digest?: string } =>
  Object.assign(new Error("connect ECONNREFUSED 10.0.0.7:5432 for user orbit"), digest ? { digest } : {});

function render(digest?: string): string {
  return renderToStaticMarkup(createElement(GlobalError, { error: failure(digest), retry: () => undefined }));
}

describe("the error boundary for the root layout", () => {
  it("is a client component, as an error boundary has to be", () => {
    expect(readFileSync(SOURCE, "utf8").trimStart().startsWith('"use client";')).toBe(true);
  });

  it("renders its own document, because it replaces the root layout", () => {
    const html = render();
    expect(html.startsWith('<html lang="en">')).toBe(true);
    expect(html).toContain("<body");
    expect(html).toContain("<title>Something went wrong | OrbitDiff Web</title>");
  });

  it("says what happened in an alert with one heading", () => {
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("OrbitDiff Web could not be shown");
  });

  it("never shows the message of the error, which can hold internal detail", () => {
    const html = render("4021337");
    expect(html).not.toContain("ECONNREFUSED");
    expect(html).not.toContain("10.0.0.7");
    expect(html).toContain("4021337");
  });

  it("shows no reference line when the error has no digest", () => {
    expect(render()).not.toContain("Reference");
  });

  it("has a Try again button that calls retry once per click", () => {
    let calls = 0;
    const tree = GlobalError({ error: failure(), retry: () => void (calls += 1) });
    const buttons = elements(tree).filter((element) => typeof element.props.onClick === "function");
    expect(buttons.map((button) => textOf(button))).toEqual(["Try again"]);
    expect(buttons[0]!.type).toBe("button");

    buttons[0]!.props.onClick!();
    expect(calls).toBe(1);
    buttons[0]!.props.onClick!();
    expect(calls).toBe(2);
  });

  it("renders the button as a real button, not a link or a script handler string", () => {
    const html = render();
    expect(html).toMatch(/<button type="button"[^>]*>Try again<\/button>/);
    expect(html).not.toMatch(/\son[a-z]+="/);
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/\sstyle="/);
  });

  it("offers the home page as a second way out, as a full page load", () => {
    expect(render()).toMatch(/<a href="\/"[^>]*>Go to the home page<\/a>/);
  });
});
