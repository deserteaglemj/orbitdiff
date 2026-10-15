import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ALLOWANCES,
  BUILTINS,
  checkApp,
  checkFile,
  checkTree,
  formatFinding,
  NETWORK_ALLOWANCES,
  PACKAGES,
  RULES,
} from "../../../scripts/check-hosted-rules.mjs";

const WEB = path.resolve(import.meta.dirname, "../../..");
const SRC = path.join(WEB, "src");
const SCRIPT = path.join(WEB, "scripts", "check-hosted-rules.mjs");

interface Fixture {
  /** The rule that must fire. */
  rule: string;
  /** The rejected state, in words. */
  state: string;
  /** Path relative to the hosted source root. */
  file: string;
  source: string;
}

/**
 * One failing fixture per rejected state. Each holds exactly one thing the
 * gate must refuse, so a rule that stops firing shows up as one named test.
 */
const REJECTED: readonly Fixture[] = [
  // The local collector, also when its name is assembled from pieces.
  { rule: "collector", state: "an import of the collector", file: "server/collect.ts", source: 'import instaloader from "instaloader";\n' },
  { rule: "collector", state: "a dynamic import of the collector", file: "server/collect.ts", source: 'const lib = await import("instaloader");\n' },
  { rule: "collector", state: "a re-export of the collector", file: "server/collect.ts", source: 'export * from "instaloader";\n' },
  { rule: "collector", state: "the collector name in mixed case", file: "server/collect.ts", source: 'const name = "InstaLoader";\n' },
  { rule: "collector", state: "a mention of the collector in a comment", file: "server/jobs/handlers.ts", source: "// TODO: run Instaloader here for public lists\nexport {};\n" },
  { rule: "collector", state: "a mention of the collector in interface copy", file: "components/help.tsx", source: "export const HELP = <p>Powered by instaloader.</p>;\n" },
  { rule: "collector", state: "the collector name joined from two strings", file: "server/collect.ts", source: 'const lib = await import("insta" + "loader");\n' },
  { rule: "collector", state: "the collector name joined from an array", file: "server/collect.ts", source: 'const lib = require(["insta", "loader"].join(""));\n' },
  { rule: "collector", state: "another Instagram client library by name", file: "server/pull.ts", source: "const client = new IgApiClient();\n" },

  // Imports: a closed list of packages and Node modules, and literal names only.
  { rule: "import", state: "a dynamic import built from pieces", file: "server/collect.ts", source: 'const lib = await import("insta" + "loader");\n' },
  { rule: "import", state: "a require whose argument is not one quoted string", file: "server/collect.ts", source: 'const lib = require(["insta", "loader"].join(""));\n' },
  { rule: "import", state: "a dynamic import of a variable", file: "server/collect.ts", source: "const lib = await import(name);\n" },
  { rule: "import", state: "an Instagram client package", file: "server/pull.ts", source: 'import { IgApiClient } from "instagram-private-api";\n' },
  { rule: "import", state: "another package that is not listed", file: "server/pull.ts", source: 'import { Client } from "instagrapi";\n' },
  { rule: "import", state: "an HTTP client package", file: "server/pull.ts", source: 'import axios from "axios";\n' },
  { rule: "import", state: "the Node module that starts programs", file: "server/pull.ts", source: 'import { spawn } from "node:child_process";\n' },
  { rule: "import", state: "the same module through require, without the node prefix", file: "server/pull.ts", source: 'const { spawn } = require("child_process");\n' },
  { rule: "import", state: "a Node module that is not listed", file: "server/pull.ts", source: 'import { readFile } from "node:fs/promises";\n' },
  { rule: "import", state: "a relative import that leaves the hosted source", file: "server/pull.ts", source: 'import { pull } from "../../scripts/pull";\n' },
  { rule: "import", state: "a stylesheet import from another host", file: "app/globals.css", source: '@import url("https://fonts.example.test/a.css");\n' },

  // Starting another program, such as the local command line tool.
  { rule: "process", state: "running the local command line tool", file: "server/pull.ts", source: 'spawn("orbit-os", ["collect", handle]);\n' },
  { rule: "process", state: "running the Python package", file: "server/pull.ts", source: 'spawn("python3", ["-m", "orbitdiff", "collect", handle]);\n' },
  { rule: "process", state: "running a shell command", file: "server/pull.ts", source: "execSync(`orbit-os collect ${handle}`);\n" },
  { rule: "process", state: "naming the Node module that starts programs", file: "server/pull.ts", source: 'const cp = process.getBuiltinModule("child_process");\n' },

  // A saved session file.
  { rule: "session-file", state: "reading a file whose path names a session", file: "server/ig.ts", source: 'import { readFileSync } from "node:fs";\nconst raw = readFileSync(join(dir, "session-atlas_studio"));\n' },
  { rule: "session-file", state: "an asynchronous read of a session path", file: "server/ig.ts", source: "const raw = await readFile(sessionPath, \"utf8\");\n" },
  { rule: "session-file", state: "the collector call that loads a session", file: "server/ig.ts", source: 'loader.load_session_from_file("atlas_studio");\n' },
  { rule: "session-file", state: "a variable that holds a session file", file: "server/ig.ts", source: "const sessionFile = process.env.SAVED_LOGIN;\n" },
  { rule: "session-file", state: "a file name with the session extension", file: "server/ig.ts", source: 'const saved = "./atlas_studio.session";\n' },

  // Fields for an Instagram secret: password, verification code, cookie, session.
  { rule: "instagram-credential", state: "a password variable", file: "components/connect.tsx", source: 'const instagramPassword = form.get("secret");\n' },
  { rule: "instagram-credential", state: "a short password variable", file: "server/input.ts", source: "const igPw = body.pw;\n" },
  { rule: "instagram-credential", state: "a password form control name", file: "components/connect.tsx", source: '<input name="instagram_password" type="password" />\n' },
  { rule: "instagram-credential", state: "a password field label", file: "components/connect.tsx", source: '<Field label="Instagram password" name="secret" />\n' },
  { rule: "instagram-credential", state: "a label that names the secret before Instagram", file: "components/connect.tsx", source: '<Field label="Password for your Instagram account" name="secret" type="password" />\n' },
  { rule: "instagram-credential", state: "a label that calls the account IG", file: "components/connect.tsx", source: '<Field label="Your IG password" name="secret" type="password" />\n' },
  { rule: "instagram-credential", state: "a label that names the secret before IG", file: "components/connect.tsx", source: '<Field label="Code sent by IG" name="value" />\n' },
  { rule: "instagram-credential", state: "a label that calls the account Insta", file: "components/connect.tsx", source: '<Field label="Insta verification code" name="value" />\n' },
  { rule: "instagram-credential", state: "a label that names the secret before Insta", file: "components/connect.tsx", source: '<Field label="Session cookie from Insta" name="value" />\n' },
  { rule: "instagram-credential", state: "a placeholder that names the secret first", file: "components/connect.tsx", source: '<input placeholder="Password (Instagram)" type="password" />\n' },
  { rule: "instagram-credential", state: "an aria-label that names the secret first", file: "components/connect.tsx", source: '<input aria-label="Code for Instagram" />\n' },
  { rule: "instagram-credential", state: "a password label element", file: "components/connect.tsx", source: '<label htmlFor="a">Your Instagram password</label>\n' },
  { rule: "instagram-credential", state: "a label element whose words sit in child markup", file: "components/connect.tsx", source: '<label htmlFor="a"><strong>Instagram</strong> password</label>\n' },
  { rule: "instagram-credential", state: "a legend that names the secret first", file: "components/connect.tsx", source: "<legend>Password of your <b>IG</b> account</legend>\n" },
  { rule: "instagram-credential", state: "a plain password field under an Instagram sign-in heading", file: "components/connect.tsx", source: '<h2>Sign in to Instagram</h2>\n<Field label="Password" name="pw" type="password" />\n' },
  { rule: "instagram-credential", state: "a code field in a file that asks about the Instagram account", file: "components/connect.tsx", source: '<p>Enter the details of your Instagram account.</p>\n<input autoComplete="one-time-code" name="value" />\n' },
  { rule: "instagram-credential", state: "a password field named in reverse order", file: "server/input.ts", source: "const schema = z.strictObject({ passwordForInstagram: z.string() });\n" },
  { rule: "instagram-credential", state: "a password name that continues in camel case", file: "components/connect.tsx", source: "const instagramPasswordInput = useRef(null);\n" },
  { rule: "instagram-credential", state: "a cookie name that continues in camel case", file: "server/input.ts", source: "const igSessionCookieValue = read(request);\n" },
  { rule: "instagram-credential", state: "a password constant in capitals", file: "server/input.ts", source: "const INSTAGRAM_PASSWORD_FIELD = 1;\n" },
  { rule: "instagram-credential", state: "a verification code variable", file: "components/connect.tsx", source: "const igVerificationCode = code.trim();\n" },
  { rule: "instagram-credential", state: "a verification code control name", file: "components/connect.tsx", source: '<input name="instagram-2fa-code" inputMode="numeric" />\n' },
  { rule: "instagram-credential", state: "a verification code placeholder", file: "components/connect.tsx", source: '<input placeholder="Instagram verification code" />\n' },
  { rule: "instagram-credential", state: "a cookie variable", file: "server/input.ts", source: "const instagramCookie = body.value;\n" },
  { rule: "instagram-credential", state: "the name of the Instagram login cookie", file: "server/input.ts", source: 'const value = jar.get("sessionid");\n' },
  { rule: "instagram-credential", state: "the login cookie name in another case", file: "server/input.ts", source: 'const value = jar.get("SessionID");\n' },
  { rule: "instagram-credential", state: "the login cookie name joined from two strings", file: "server/input.ts", source: 'const value = jar.get("session" + "id");\n' },
  { rule: "instagram-credential", state: "the name of the Instagram request cookie", file: "server/input.ts", source: 'headers.set("x-csrftoken", jar.csrftoken);\n' },
  { rule: "instagram-credential", state: "a session variable", file: "server/input.ts", source: "const instagramSession = await restore();\n" },
  { rule: "instagram-credential", state: "a session id column", file: "server/db/extra.ts", source: 'export const igSession = text("ig_session_id");\n' },
  { rule: "instagram-credential", state: "a session field label", file: "components/connect.tsx", source: '<Field label="Paste your Instagram session" name="value" />\n' },

  // A request to an Instagram or Facebook host.
  { rule: "meta-request", state: "fetch against instagram.com", file: "server/pull.ts", source: 'await fetch("https://www.instagram.com/api/v1/friendships/1/followers/");\n' },
  { rule: "meta-request", state: "fetch against facebook.com", file: "server/pull.ts", source: "await fetch(`https://graph.facebook.com/v19.0/${id}?fields=followers_count`);\n" },
  { rule: "meta-request", state: "fetch against Threads", file: "server/pull.ts", source: 'await fetch("https://www.threads.net/api/graphql");\n' },
  { rule: "meta-request", state: "fetch against a host joined from two strings", file: "server/pull.ts", source: 'await fetch("https://www.insta" + "gram.com/atlas_studio/");\n' },
  { rule: "meta-request", state: "fetch split over several lines", file: "server/pull.ts", source: 'await fetch(\n  "https://graph.instagram.com/me",\n  { method: "GET" },\n);\n' },
  { rule: "meta-request", state: "an HTTP client package against instagram.com", file: "server/pull.ts", source: 'const page = await axios.get("https://i.instagram.com/api/v1/users/web_profile_info/");\n' },
  { rule: "meta-request", state: "another HTTP client against facebook.com", file: "server/pull.ts", source: 'const page = await got("https://www.facebook.com/atlas_studio");\n' },
  { rule: "meta-request", state: "the node https module against instagram.com", file: "server/pull.ts", source: 'https.request({ host: "graph.instagram.com", path: "/me" });\n' },
  { rule: "meta-request", state: "a browser request object against instagram.com", file: "components/pull.tsx", source: 'const xhr = new XMLHttpRequest();\nxhr.open("GET", "https://www.instagram.com/atlas_studio/");\n' },
  {
    rule: "meta-request",
    state: "a request through a variable in a file that may name the host",
    file: "components/dashboard/add-profile-form.tsx",
    source: 'const EXAMPLE = "https://www.instagram.com/atlas_studio/";\nawait fetch(EXAMPLE);\n',
  },

  // Any other request whose target is not a quoted path on this site.
  {
    rule: "request",
    state: "a request built from a host set imported from the domain",
    file: "server/pull.ts",
    source: 'import { HOSTS } from "@/domain/handles";\nconst [, host] = [...HOSTS];\nexport async function pull(handle: string) {\n  return fetch(`https://${host}/${handle}/?__a=1`);\n}\n',
  },
  { rule: "request", state: "fetch against an address taken from the environment", file: "server/pull.ts", source: "await fetch(`${process.env.UPSTREAM_ORIGIN}/api/v1/friendships/${id}/followers/`);\n" },
  { rule: "request", state: "fetch against an address given as numbers", file: "server/pull.ts", source: 'await fetch("https://157.240.229.174/atlas_studio/");\n' },
  { rule: "request", state: "fetch of a variable in a file that names no host", file: "server/pull.ts", source: "const page = await fetch(url);\n" },
  { rule: "request", state: "a protocol-relative address", file: "components/pull.tsx", source: 'await fetch("//example.test/a");\n' },
  { rule: "request", state: "a path whose first segment is interpolated", file: "components/pull.tsx", source: "await fetch(`/${target}`);\n" },
  { rule: "request", state: "a listed helper call in a file it is not listed for", file: "components/other.ts", source: 'const response = await fetch(path, { method: "GET" });\n' },
  { rule: "request", state: "a socket to another host", file: "server/pull.ts", source: 'const socket = new WebSocket("wss://example.test/live");\n' },
  { rule: "request", state: "fetch called through another name", file: "server/pull.ts", source: "const get = globalThis.fetch;\nawait get(url);\n" },
  { rule: "request", state: "fetch looked up by a quoted name", file: "server/pull.ts", source: 'await globalThis["fetch"](url);\n' },

  // A host that is not one of the listed allowances, so nothing can reach it indirectly.
  { rule: "meta-host", state: "an Instagram address kept in a constant", file: "server/pull.ts", source: 'const BASE = "https://graph.instagram.com";\n' },
  { rule: "meta-host", state: "a Facebook host without a scheme", file: "server/pull.ts", source: 'const HOST = "graph.facebook.com";\n' },
  { rule: "meta-host", state: "a Threads host", file: "server/pull.ts", source: 'const url = "https://www.threads.net/api/graphql";\n' },
  { rule: "meta-host", state: "the newer Threads host", file: "server/pull.ts", source: 'const url = "https://www.threads.com/@atlas_studio";\n' },
  { rule: "meta-host", state: "the Instagram short link host", file: "server/pull.ts", source: 'const link = "https://ig.me/m/atlas_studio";\n' },
  { rule: "meta-host", state: "a Meta host", file: "server/pull.ts", source: 'const api = "https://graph.meta.com/me";\n' },
  { rule: "meta-host", state: "an Instagram link that is not a listed help link", file: "components/help.tsx", source: '<a href="https://www.instagram.com/accounts/login/">Sign in to Instagram</a>\n' },
  { rule: "meta-host", state: "a listed link in a file it is not listed for", file: "components/help.tsx", source: '<a href="https://help.instagram.com/181231772500920">Export help</a>\n' },
  { rule: "meta-host", state: "a longer address that starts like a listed one", file: "domain/handles.ts", source: 'const x = "https://www.instagram.com/atlas_studio/followers/";\n' },
  { rule: "meta-host", state: "the Instagram media host", file: "components/avatar.tsx", source: '<img src="https://scontent.cdninstagram.com/v/a.jpg" alt="" />\n' },
  { rule: "meta-host", state: "a host written inside a pattern", file: "server/match.ts", source: "const HOST = /(^|\\.)instagram\\.com$/;\n" },
  { rule: "meta-host", state: "a host in capitals", file: "server/match.ts", source: 'const HOST = "WWW.INSTAGRAM.COM";\n' },
  { rule: "meta-host", state: "an allowed host set that is exported", file: "domain/handles.ts", source: 'export const HOSTS = new Set(["instagram.com", "www.instagram.com"]);\n' },
  {
    rule: "meta-host",
    state: "an allowed host set read out to build an address",
    file: "domain/handles.ts",
    source: 'const HOSTS = new Set(["instagram.com", "www.instagram.com"]);\nexport const profileUrl = (handle: string) => "https://" + [...HOSTS][1] + "/" + handle + "/?__a=1";\n',
  },
  { rule: "meta-host", state: "an allowed bare host outside a host set", file: "domain/export/rows.ts", source: 'export const HOST = "www.instagram.com";\n' },

  // A path on this site that answers with another host.
  { rule: "rewrite", state: "a rewrite in the proxy", file: "proxy.ts", source: "return NextResponse.rewrite(new URL(target));\n" },
  { rule: "rewrite", state: "a rewrite list in a configuration", file: "config.ts", source: 'export const config = { rewrites: [{ source: "/a", destination: "/b" }] };\n' },

  // Claims the capability matrix forbids, in either word order.
  { rule: "claim", state: "production-ready", file: "app/page.tsx", source: "<p>OrbitDiff Web is production-ready.</p>\n" },
  { rule: "claim", state: "production ready without the hyphen", file: "app/page.tsx", source: "<p>A Production Ready tracker.</p>\n" },
  { rule: "claim", state: "ready for production", file: "app/page.tsx", source: "<p>Ready for production.</p>\n" },
  { rule: "claim", state: "production-grade", file: "app/page.tsx", source: "<p>A production-grade tracker.</p>\n" },
  { rule: "claim", state: "real-time tracking", file: "app/page.tsx", source: "<h2>Real-time tracking of your followers</h2>\n" },
  { rule: "claim", state: "realtime tracking written as one word", file: "components/capability-copy.ts", source: 'export const LEAD = "Realtime tracking for every profile";\n' },
  { rule: "claim", state: "real time before the noun", file: "app/page.tsx", source: "<p>Real-time follower tracking.</p>\n" },
  { rule: "claim", state: "in real time after the noun", file: "app/page.tsx", source: "<p>Follower tracking in real time.</p>\n" },
  { rule: "claim", state: "live tracking", file: "app/page.tsx", source: "<p>Live tracking of your followers.</p>\n" },
  { rule: "claim", state: "automatic tracking", file: "app/page.tsx", source: "<li>Automatic tracking, every day</li>\n" },
  { rule: "claim", state: "automatic tracking broken over two lines", file: "app/page.tsx", source: "<p>\n  Set it up once and enjoy automatic\n  tracking.\n</p>\n" },
  { rule: "claim", state: "automatically before the verb", file: "app/page.tsx", source: "<p>OrbitDiff automatically tracks your followers.</p>\n" },
  { rule: "claim", state: "tracks followers automatically", file: "app/page.tsx", source: "<p>It tracks followers automatically.</p>\n" },
  { rule: "claim", state: "tracks your followers automatically", file: "app/page.tsx", source: "<p>OrbitDiff tracks your followers automatically.</p>\n" },
  { rule: "claim", state: "automated tracking", file: "app/page.tsx", source: "<p>Automated tracking of who unfollowed you.</p>\n" },
  { rule: "claim", state: "auto-tracking", file: "app/page.tsx", source: "<p>Auto-tracking for every profile.</p>\n" },
  { rule: "claim", state: "tracking said to be automatic", file: "app/page.tsx", source: "<p>Identity tracking is automatic.</p>\n" },
  { rule: "claim", state: "automatic tracking split by a JSX space", file: "app/page.tsx", source: '<p>automatic{" "}tracking</p>\n' },
  { rule: "claim", state: "automatic tracking joined by a no-break space", file: "app/page.tsx", source: "<p>automatic&nbsp;tracking</p>\n" },
  { rule: "claim", state: "automatic tracking across inline markup", file: "app/page.tsx", source: "<p><strong>Automatic</strong> tracking</p>\n" },
  { rule: "claim", state: "a claim beside a negation in another element", file: "app/page.tsx", source: "<h2>Real-time follower tracking</h2>\n<p>We never sell data.</p>\n" },
  { rule: "claim", state: "a claim after a negation in another clause", file: "app/page.tsx", source: "<p>We never sell data and OrbitDiff tracks your followers automatically.</p>\n" },
  { rule: "claim", state: "tracking from Instagram", file: "app/page.tsx", source: "<p>OrbitDiff tracks your followers from Instagram.</p>\n" },
  { rule: "claim", state: "the same claim in a mail text", file: "server/mail/text.ts", source: 'export const LINE = "It tracks your followers automatically, so you never import again.";\n' },
];

/** Hosted code and copy that must stay allowed. A gate that flags these would be switched off. */
const ACCEPTED: ReadonlyArray<{ state: string; file: string; source: string }> = [
  { state: "copy that says no Instagram secret is asked for", file: "app/page.tsx", source: "<p>OrbitDiff Web never asks for an Instagram password, verification code, cookie, or session.</p>\n" },
  { state: "a field hint that says the same", file: "components/x.tsx", source: '<PageHeader description="Nothing here asks for an Instagram password, code, or session." />\n' },
  { state: "a request to this site", file: "components/dashboard/api.ts", source: 'const response = await fetch("/api/me", { credentials: "same-origin" });\n' },
  { state: "a request helper that is listed for its file", file: "components/dashboard/api.ts", source: 'response = await fetch(path, {\n  method,\n  credentials: "same-origin",\n});\n' },
  { state: "the OrbitDiff login list", file: "components/settings/sessions-panel.tsx", source: "const rows = sessionRows(list.data, current.data?.session?.token ?? null);\n" },
  { state: "the OrbitDiff password field", file: "components/auth/sign-in-form.tsx", source: '<Field label="Password (required)" name="password" type="password" />\n' },
  {
    state: "a password field in a file that says Instagram is not asked for",
    file: "components/auth/sign-up-form.tsx",
    source: '/** It asks for nothing about an Instagram login. */\n<Field label="Password" name="password" type="password" />\n',
  },
  {
    state: "a password field in a file that says the Instagram account is not affected",
    file: "components/settings/delete-account-form.tsx",
    source: '<p>\n  Your Instagram account is not affected: OrbitDiff Web was never connected to it.\n</p>\n<Field label="Password" name="password" type="password" />\n',
  },
  { state: "the statement that automatic identity tracking is unavailable", file: "components/capability-copy.ts", source: 'export const NOTICE = "Automatic identity tracking is unavailable.";\n' },
  { state: "the same statement with words between", file: "app/page.tsx", source: "<p>Automatic follower and following identity tracking is unavailable.</p>\n" },
  { state: "the wording rule, which negates the claim", file: "components/x.tsx", source: "<p>OrbitDiff Web never tracks followers automatically, in real time, or from Instagram.</p>\n" },
  { state: "a statement that a preview is not ready for production", file: "components/x.tsx", source: "<p>This preview is not ready for production.</p>\n" },
  { state: "layout classes that contain auto and tracking", file: "components/x.tsx", source: '<h1 className="mx-auto w-auto font-bold tracking-tight">Profiles</h1>\n' },
  { state: "a live region next to a tracking class", file: "components/x.tsx", source: '<p aria-live="polite" className="tracking-tight">Saved.</p>\n' },
  { state: "an unrelated word that ends like a host", file: "domain/x.ts", source: 'const note = "notinstagram.community is not a Meta host";\n' },
  { state: "a name for the Instagram username, which is not a secret", file: "components/x.tsx", source: "const instagramHandle = profile.handle;\nconst instagramPassthrough = true;\n" },
  { state: "a comment that uses the word require", file: "components/onboarding/model.ts", source: " *   This is what the guards require (requireOnboardedUser).\n" },
  {
    state: "imports of listed packages, listed Node modules, and hosted files",
    file: "server/x.ts",
    source:
      'import { createHash } from "node:crypto";\nimport { isIP } from "node:net";\nimport { z } from "zod";\nimport { eq } from "drizzle-orm";\n' +
      'import type { NextConfig } from "next";\nimport { cx } from "@/components/ui";\nimport { a } from "./a";\nimport "server-only";\n',
  },
  { state: "the stylesheet import of the design system", file: "app/globals.css", source: '@import "tailwindcss";\n' },
  { state: "a dynamic import of a listed package", file: "components/x.tsx", source: 'const { z } = await import("zod");\n' },
  { state: "a regular expression method named exec", file: "domain/x.ts", source: "const match = LINK.exec(text);\n" },
  { state: "the verb fetch in a comment", file: "components/x.tsx", source: "// We fetch the list once, then keep it.\nconst rows = fetchSessions();\n" },
  { state: "the host set of the domain, asked only whether it holds a host", file: "domain/handles.ts", source: 'const HOSTS = new Set(["instagram.com", "www.instagram.com"]);\nif (!HOSTS.has(host.toLowerCase())) refuse();\n' },
  { state: "a harmless string joined from pieces", file: "components/x.tsx", source: 'const label = "Profile" + " list";\n' },
];

const created: string[] = [];

/** A throwaway directory holding the given files. Returns the directory. */
function tree(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(path.join(tmpdir(), "orbitdiff-rules-"));
  created.push(root);
  for (const [name, source] of Object.entries(files)) {
    const target = path.join(root, name);
    for (let dir = path.dirname(target); dir.length > root.length; dir = path.dirname(dir)) {
      if (!created.includes(dir)) created.push(dir);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
    created.push(target);
  }
  return root;
}

afterEach(() => {
  // Longest paths first: files and links, then the directories that held them.
  for (const target of created.sort((a, b) => b.length - a.length)) {
    try {
      unlinkSync(target);
    } catch {
      try {
        rmdirSync(target);
      } catch {
        // Already gone.
      }
    }
  }
  created.length = 0;
});

function run(...args: string[]): { status: number | null; out: string } {
  return runScript(SCRIPT, ...args);
}

function runScript(script: string, ...args: string[]): { status: number | null; out: string } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const CLEAN_PAGE = "export default function Page() {\n  return null;\n}\n";
const PACKAGE = JSON.stringify({ name: "x", dependencies: { next: "16.3.7", react: "19.2.8" } }, null, 2);

describe("the hosted rules gate rejects each forbidden state", () => {
  it.each(REJECTED)("$rule: $state", ({ rule, file, source }) => {
    const findings = checkFile(file, source);
    const hit = findings.find((finding) => finding.rule === rule);
    expect(findings.map((finding) => finding.rule)).toContain(rule);
    expect(hit?.file).toBe(file);
    expect(hit?.line).toBeGreaterThanOrEqual(1);
    expect(hit?.reason.length).toBeGreaterThan(20);
  });

  it("reports the line of the offending text, not the top of the file", () => {
    const source = 'export const a = 1;\n\nconst saved = "./atlas_studio.session";\n';
    expect(checkFile("server/ig.ts", source)).toMatchObject([{ rule: "session-file", line: 3 }]);
  });

  it("reports the line of a name joined from pieces over several lines, and of what follows it", () => {
    const source = 'const a = "insta" +\n  "loader";\n\nconst b = "sessionid";\n';
    expect(checkFile("server/x.ts", source).map((finding) => `${finding.line}:${finding.rule}`)).toEqual([
      "1:collector",
      "4:instagram-credential",
    ]);
  });

  it("reports every finding of a file, not only the first", () => {
    const source = 'import instaloader from "instaloader";\nconst instagramPassword = "";\n<p>production-ready</p>\n';
    expect(checkFile("app/x.tsx", source).map((finding) => `${finding.line}:${finding.rule}`)).toEqual([
      "1:collector",
      "1:import",
      "2:instagram-credential",
      "3:claim",
    ]);
  });

  it("names the file, the line, the rule, and the reason in one line of output", () => {
    const [finding] = checkFile("server/collect.ts", 'import instaloader from "instaloader";\n');
    expect(formatFinding(finding!, "src")).toMatch(/^src\/server\/collect\.ts:1: \[collector\] \S.{20,}$/);
  });
});

describe("the hosted rules gate accepts what the app really contains", () => {
  it.each(ACCEPTED)("$state", ({ file, source }) => {
    expect(checkFile(file, source)).toEqual([]);
  });
});

describe("the allowances are exact", () => {
  it("lists only help links and the address parsing rules of the domain", () => {
    expect(ALLOWANCES.map((entry) => `${entry.file} ${entry.text}`).sort()).toEqual([
      "app/page.tsx https://help.instagram.com/181231772500920",
      "components/dashboard/add-profile-form.tsx https://www.instagram.com/atlas_studio/",
      "components/onboarding/onboarding-flow.tsx https://www.instagram.com/atlas_studio/",
      "domain/export/rows.ts instagram.com",
      "domain/export/rows.ts www.instagram.com",
      "domain/handles.ts https://www.instagram.com/atlas_studio/",
      "domain/handles.ts instagram.com",
      "domain/handles.ts www.instagram.com",
    ]);
    for (const entry of ALLOWANCES) expect(entry.why.length).toBeGreaterThan(10);
  });

  it.each(ALLOWANCES)("accepts $text in $file", ({ file, text }) => {
    expect(checkFile(file, `<p>For example ${text}. Then continue.</p>\n`)).toEqual([]);
    const declared = text.includes("/") ? `const value = "${text}";\n` : `const HOSTS = new Set(["${text}"]);\n`;
    expect(checkFile(file, declared)).toEqual([]);
  });

  it.each(ALLOWANCES)("rejects $text outside $file", ({ text }) => {
    expect(checkFile("server/other.ts", `const value = "${text}";\n`).map((finding) => finding.rule)).toEqual(["meta-host"]);
  });

  it.each(ALLOWANCES)("is still needed: $file holds $text", ({ file, text }) => {
    // An allowance nothing uses is a hole. Remove it from the script when the text goes.
    expect(readFileSync(path.join(SRC, file), "utf8")).toContain(text);
  });

  it("does not let a listed address be requested, even in its own file", () => {
    const source = 'await fetch("https://help.instagram.com/181231772500920");\n';
    expect(checkFile("app/page.tsx", source).map((finding) => finding.rule)).toEqual(["meta-request"]);
  });

  it("lets a file that names a listed address call this site by path", () => {
    const source = 'const hint = "https://www.instagram.com/atlas_studio/";\nawait fetch("/api/profiles", { method: "POST" });\n';
    expect(checkFile("components/dashboard/add-profile-form.tsx", source)).toEqual([]);
  });

  it("lists the request helpers that take their path as a parameter, and each is still needed", () => {
    expect(NETWORK_ALLOWANCES.map((entry) => `${entry.file} ${entry.call}`).sort()).toEqual([
      "components/admin/api.ts fetch(path",
      "components/dashboard/api.ts fetch(path",
      "components/onboarding/api.ts fetch(path",
    ]);
    for (const entry of NETWORK_ALLOWANCES) {
      expect(entry.why.length).toBeGreaterThan(10);
      expect(readFileSync(path.join(SRC, entry.file), "utf8")).toContain(`${entry.call},`);
    }
  });

  it("lists exactly the runtime dependencies as importable packages", () => {
    const manifest = JSON.parse(readFileSync(path.join(WEB, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(PACKAGES.filter((entry) => entry.dependency).map((entry) => entry.name).sort()).toEqual(Object.keys(manifest.dependencies).sort());
    for (const entry of PACKAGES) expect(entry.why.length).toBeGreaterThan(10);
  });

  it.each(BUILTINS)("lists the Node module $name only while the hosted source imports it", ({ name, why }) => {
    expect(why.length).toBeGreaterThan(10);
    const sources = spawnSync("grep", ["-rl", `from "${name}"`, SRC], { encoding: "utf8" });
    expect(sources.stdout.trim().length).toBeGreaterThan(0);
  });
});

/** Rejected states that only exist at the level of the app directory. */
const APP_REJECTED: ReadonlyArray<{ rule: string; state: string; files: Record<string, string>; at: string }> = [
  {
    rule: "rewrite",
    state: "a rewrite to Instagram in next.config.ts",
    files: { "next.config.ts": 'export default {\n  async rewrites() {\n    return [{ source: "/ig/:path*", destination: "https://www.instagram.com/:path*" }];\n  },\n};\n' },
    at: "next.config.ts",
  },
  {
    rule: "rewrite",
    state: "a rewrite to any other host in next.config.mjs",
    files: { "next.config.mjs": 'export default { rewrites: async () => [{ source: "/x/:p*", destination: "https://example.test/:p*" }] };\n' },
    at: "next.config.mjs",
  },
  {
    rule: "rewrite",
    state: "a rewrite in vercel.json",
    files: { "vercel.json": '{\n  "rewrites": [{ "source": "/x", "destination": "https://example.test/" }]\n}\n' },
    at: "vercel.json",
  },
  {
    rule: "meta-request",
    state: "a script in public that requests Instagram",
    files: { "public/pull.js": 'fetch("https://www.instagram.com/atlas_studio/?__a=1");\n' },
    at: "public/pull.js",
  },
  {
    rule: "dependency",
    state: "a runtime dependency that is not listed",
    files: { "package.json": JSON.stringify({ dependencies: { next: "16.3.7", "instagram-private-api": "1.46.1" } }, null, 2) },
    at: "package.json",
  },
  {
    rule: "dependency",
    state: "a development dependency named like an Instagram client",
    files: { "package.json": JSON.stringify({ dependencies: { next: "16.3.7" }, devDependencies: { "insta-fetcher": "1.0.0" } }, null, 2) },
    at: "package.json",
  },
  {
    rule: "process",
    state: "a package script that runs the local collector",
    files: { "package.json": JSON.stringify({ scripts: { "vercel-build": "orbit-os collect atlas_studio && next build" }, dependencies: { next: "16.3.7" } }, null, 2) },
    at: "package.json",
  },
  {
    rule: "dependency",
    state: "a package file that is not JSON",
    files: { "package.json": "{ dependencies: " },
    at: "package.json",
  },
];

function app(files: Record<string, string | Buffer>): string {
  return tree({ "src/app/page.tsx": CLEAN_PAGE, "package.json": PACKAGE, ...files });
}

describe("every rule has a failing fixture", () => {
  it("covers each rule id the script declares", () => {
    const covered = new Set([...REJECTED.map((fixture) => fixture.rule), ...APP_REJECTED.map((fixture) => fixture.rule), "empty-tree", "unreadable"]);
    expect(RULES.map((rule) => rule.id).filter((id) => !covered.has(id))).toEqual([]);
    expect(RULES.map((rule) => rule.id).sort()).toEqual([
      "claim",
      "collector",
      "dependency",
      "empty-tree",
      "import",
      "instagram-credential",
      "meta-host",
      "meta-request",
      "process",
      "request",
      "rewrite",
      "session-file",
      "unreadable",
    ]);
  });
});

describe("the gate over a tree", () => {
  it("passes a clean tree and counts its files", () => {
    const root = tree({ "app/page.tsx": CLEAN_PAGE, "domain/a.ts": "export const a = 1;\n" });
    expect(checkTree(root)).toEqual({ files: 2, findings: [] });
  });

  it("finds a violation in a nested directory and names the file relative to the root", () => {
    const root = tree({ "app/page.tsx": "export {};\n", "server/jobs/pull.ts": 'import "instaloader";\n' });
    expect(checkTree(root).findings).toMatchObject([
      { file: "server/jobs/pull.ts", line: 1, rule: "collector" },
      { file: "server/jobs/pull.ts", line: 1, rule: "import" },
    ]);
  });

  it("fails for a tree with no files, so a wrong path cannot pass", () => {
    const root = tree({});
    expect(checkTree(root).findings).toMatchObject([{ rule: "empty-tree" }]);
  });

  it("fails for a directory that does not exist", () => {
    const missing = path.join(tmpdir(), "orbitdiff-rules-missing", "src");
    expect(checkTree(missing).findings).toMatchObject([{ rule: "empty-tree" }]);
  });

  it("fails for a file it cannot read as text, instead of skipping it", () => {
    const root = tree({ "app/page.tsx": "export {};\n" });
    const binary = path.join(root, "app", "blob.ts");
    writeFileSync(binary, Buffer.from([0x66, 0x6f, 0x6f, 0xff, 0xfe, 0x00]));
    created.push(binary);
    expect(checkTree(root).findings).toMatchObject([{ file: "app/blob.ts", rule: "unreadable" }]);
  });

  it("fails for a link, which could point outside the tree", () => {
    const root = tree({ "app/page.tsx": "export {};\n" });
    const link = path.join(root, "app", "linked.ts");
    symlinkSync(path.join(root, "app", "page.tsx"), link);
    created.push(link);
    expect(checkTree(root).findings).toMatchObject([{ file: "app/linked.ts", rule: "unreadable" }]);
  });
});

describe("the gate over the app directory", () => {
  it.each(APP_REJECTED)("$rule: $state", ({ rule, files, at }) => {
    const findings = checkApp(app(files)).findings;
    expect(findings.filter((finding) => finding.file === at).map((finding) => finding.rule)).toContain(rule);
  });

  it("passes a clean app and counts the files of src, public, the configuration, and the package file", () => {
    const root = app({ "next.config.ts": "export default {};\n", "public/mark.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>\n' });
    expect(checkApp(root)).toEqual({ files: 4, findings: [] });
  });

  it("names every file by its path in the app directory", () => {
    const root = app({ "src/server/pull.ts": 'import "instaloader";\n' });
    expect(checkApp(root).findings.map((finding) => formatFinding(finding))).toContain(
      "src/server/pull.ts:1: [collector] mentions instaloader: the hosted app never imports, runs, or refers to the local collector",
    );
  });

  it("finds each part of a request that a same-site path would forward to Instagram", () => {
    const root = app({
      "src/server/pull.ts": 'export const pull = () => fetch("/ig/atlas_studio/?__a=1");\n',
      "next.config.ts": 'export default { rewrites: async () => [{ source: "/ig/:path*", destination: "https://www.instagram.com/:path*" }] };\n',
      "public/pull.js": 'fetch("https://www.instagram.com/atlas_studio/?__a=1");\n',
      "package.json": JSON.stringify({ dependencies: { next: "16.3.7", "instagram-private-api": "1.46.1" } }, null, 2),
    });
    const files = new Set(checkApp(root).findings.map((finding) => finding.file));
    expect([...files].sort()).toEqual(["next.config.ts", "package.json", "public/pull.js"]);
  });

  it("accepts an image in public, but not a link or a file that is not text", () => {
    const root = app({ "public/mark.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]) });
    expect(checkApp(root).findings).toEqual([]);
    const link = path.join(root, "public", "other.js");
    symlinkSync(path.join(root, "src", "app", "page.tsx"), link);
    created.push(link);
    writeFileSync(path.join(root, "public", "blob.js"), Buffer.from([0x66, 0xff, 0x00]));
    created.push(path.join(root, "public", "blob.js"));
    expect(checkApp(root).findings.map((finding) => `${finding.file} ${finding.rule}`).sort()).toEqual([
      "public/blob.js unreadable",
      "public/other.js unreadable",
    ]);
  });

  it("fails for an app directory without a hosted source or a package file", () => {
    const root = tree({ "next.config.ts": "export default {};\n" });
    expect(checkApp(root).findings.map((finding) => `${finding.file} ${finding.rule}`)).toEqual(["package.json unreadable", "src empty-tree"]);
  });
});

describe("the gate as a command", () => {
  it("exits 1 and prints one line per finding with the file and the reason", () => {
    const root = tree({
      "app/page.tsx": "<p>OrbitDiff tracks your followers automatically.</p>\n",
      "server/pull.ts": 'await fetch("https://www.instagram.com/atlas_studio/?__a=1");\n',
    });
    const result = run(root);
    expect(result.status).toBe(1);
    const lines = result.out.trim().split("\n");
    expect(lines.some((line) => /app\/page\.tsx:1: \[claim\] /.test(line))).toBe(true);
    expect(lines.some((line) => /server\/pull\.ts:1: \[meta-request\] /.test(line))).toBe(true);
    expect(result.out).toMatch(/hosted rules: failed, \d+ findings? in 2 files/);
  });

  it("exits 1 for an empty directory", () => {
    const result = run(tree({}));
    expect(result.status).toBe(1);
    expect(result.out).toContain("[empty-tree]");
  });

  it("exits 0 for a clean tree", () => {
    const result = run(tree({ "app/page.tsx": "export {};\n" }));
    expect(result.status).toBe(0);
    expect(result.out).toMatch(/hosted rules: 1 file checked, no findings/);
  });

  it("checks another app directory with --app", () => {
    const root = app({ "next.config.ts": 'export default { rewrites: async () => [{ source: "/a", destination: "https://example.test/" }] };\n' });
    const result = run("--app", root);
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/^next\.config\.ts:1: \[rewrite\] /m);
    expect(result.out).toMatch(/hosted rules: failed, 1 finding in 3 files/);
  });

  it("still checks when it is started through a linked directory", () => {
    const holder = mkdtempSync(path.join(tmpdir(), "orbitdiff-link-"));
    created.push(holder);
    const linked = path.join(holder, "scripts");
    symlinkSync(path.dirname(SCRIPT), linked);
    created.push(linked);
    const script = path.join(linked, path.basename(SCRIPT));

    const failing = runScript(script, tree({ "server/collect.ts": 'import instaloader from "instaloader";\n' }));
    expect(failing.out).toMatch(/server\/collect\.ts:1: \[collector\] /);
    expect(failing.out).toMatch(/hosted rules: failed/);
    expect(failing.status).toBe(1);

    const clean = runScript(script, tree({ "app/page.tsx": "export {};\n" }));
    expect(clean.out).toMatch(/hosted rules: 1 file checked, no findings/);
    expect(clean.status).toBe(0);
  });
});

describe("the real hosted app", () => {
  it("has no finding in src", () => {
    const result = checkTree(SRC);
    expect(result.findings.map((finding) => formatFinding(finding, "src"))).toEqual([]);
    expect(result.files).toBeGreaterThan(150);
  });

  it("has no finding in the whole app directory", () => {
    const result = checkApp(WEB);
    expect(result.findings.map((finding) => formatFinding(finding))).toEqual([]);
    expect(result.files).toBeGreaterThan(150);
  });

  it("passes the command with its default root, the app directory", () => {
    const result = run();
    expect(result.out).toMatch(/hosted rules: \d+ files checked, no findings/);
    expect(result.status).toBe(0);
  });
});
