#!/usr/bin/env node
/**
 * Static gate over the hosted app. It fails when a file does something the
 * hosted app must never do. See docs/web/capability-matrix.md, "What the
 * hosted app never does".
 *
 *   node scripts/check-hosted-rules.mjs               checks this app directory
 *   node scripts/check-hosted-rules.mjs --app <dir>   checks another app directory
 *   node scripts/check-hosted-rules.mjs <dir>         checks one source tree only
 *
 * An app directory is checked as: every file under src/ and public/, the Next.js
 * and Vercel configuration (next.config.*, vercel.json), and package.json. Those
 * are the files that run on the platform or decide what runs there.
 *
 * Exit status 0 means no finding. Otherwise every finding is printed as
 * `file:line: [rule] reason` and the status is 1.
 *
 * The gate is written from the list of states to reject (RULES below), and
 * tests/unit/rules/hosted-rules.test.ts holds at least one failing fixture per
 * state. It reads text, not a syntax tree, so it also reads comments and copy.
 * It fails closed: an empty tree, a link, a file that is not text, or a missing
 * package.json is a finding, never a pass.
 *
 * Where it can, a rule is a closed list rather than a list of known bad names:
 * an import must name a file of the hosted source, a listed package, or a
 * listed Node module, in one quoted string; a network call must target a quoted
 * path on this site, except in the three listed request helpers; a Meta host
 * may appear only as one of the exact ALLOWANCES. Strings joined with `+` are
 * read joined, and the collector's name is also looked for with every
 * character that is not a letter or a digit removed.
 *
 * What it cannot see:
 * - A value assembled at run time from something it cannot read, such as the
 *   environment or character codes. The closed rules above leave such a value
 *   no way into an import or a request, except through the path parameter of a
 *   listed request helper: the gate cannot follow what a caller passes there.
 * - Meaning spread over files, such as a heading in one component and a
 *   password field in another.
 * - Files outside the app directory's hosted parts: scripts/ (build and
 *   development tools; the build runs only scripts/migrate.ts, which applies
 *   the SQL migrations) and tests/.
 */
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { builtinModules } from "node:module";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ file: string, line: number, rule: string, reason: string }} Finding
 * @typedef {{ id: string, rejects: string }} Rule
 * @typedef {{ file: string, text: string, why: string }} Allowance
 * @typedef {{ file: string, call: string, why: string }} NetworkAllowance
 * @typedef {{ name: string, dependency: boolean, why: string }} Package
 * @typedef {{ name: string, why: string, names?: readonly string[] }} Builtin
 */

/**
 * Every state the gate rejects.
 * @type {ReadonlyArray<Rule>}
 */
export const RULES = [
  {
    id: "collector",
    rejects:
      "An import or any mention of instaloader, the local collector, also when the name is joined from pieces, or of another Instagram client library.",
  },
  {
    id: "import",
    rejects:
      "An import of anything but a file of the hosted source, a listed package, or a listed Node module; a dynamic import or require whose argument is not one quoted string.",
  },
  { id: "process", rejects: "Starting another program: child_process, spawn, exec, fork, or a package script that runs the local tools." },
  { id: "session-file", rejects: "Reading or naming a saved session file." },
  {
    id: "instagram-credential",
    rejects:
      "A field, variable, or form control for an Instagram password, verification code, cookie, or session: a name, a label in either word order, or a password or code control in a file that names Instagram outside a sentence that says no.",
  },
  { id: "meta-request", rejects: "fetch or another network call against an Instagram, Facebook, Threads, or Meta host." },
  { id: "request", rejects: "Any other network call whose target is not a quoted path on this site, outside the listed request helpers." },
  {
    id: "meta-host",
    rejects:
      "An Instagram, Facebook, Threads, or Meta host name that is not one of the listed allowances, or an allowed bare host that is exported or used for anything but a membership test.",
  },
  { id: "rewrite", rejects: "A rewrite in the configuration or the proxy: a path on this site must never answer with another host." },
  { id: "dependency", rejects: "A runtime dependency that is not a listed package, or any dependency named like an Instagram client." },
  {
    id: "claim",
    rejects:
      "A claim the capability matrix forbids: tracking paired with automatic, automated, auto, real time, realtime, or live, or with from Instagram, and production paired with ready or grade, in either order, unless the clause says it is not so.",
  },
  { id: "empty-tree", rejects: "A tree with no files: a wrong path must not pass." },
  { id: "unreadable", rejects: "A link, or a file that is not text: it cannot be checked, so it cannot pass." },
];

/**
 * The only places that may name an Instagram host, and the exact text each may
 * hold. Paths are relative to the hosted source root (web/src). A host text
 * that is longer, shorter, or in another file is a finding. A bare host (no
 * scheme) may only sit in a `new Set([...])` that is not exported and is only
 * asked `.has(...)`. None of these may be passed to a network call.
 * @type {ReadonlyArray<Allowance>}
 */
export const ALLOWANCES = [
  {
    file: "app/page.tsx",
    text: "https://help.instagram.com/181231772500920",
    why: "Help link on the landing page: how to request your own export.",
  },
  {
    file: "components/dashboard/add-profile-form.tsx",
    text: "https://www.instagram.com/atlas_studio/",
    why: "Help text: an example of a profile link that the add-profile form accepts.",
  },
  {
    file: "components/onboarding/onboarding-flow.tsx",
    text: "https://www.instagram.com/atlas_studio/",
    why: "Help text: an example of a profile link in the onboarding step.",
  },
  {
    file: "domain/handles.ts",
    text: "instagram.com",
    why: "URL parsing rule: a host a profile link may have, and the message that names it.",
  },
  { file: "domain/handles.ts", text: "www.instagram.com", why: "URL parsing rule: a host a profile link may have." },
  {
    file: "domain/handles.ts",
    text: "https://www.instagram.com/atlas_studio/",
    why: "URL parsing rule: the example in the messages for a profile link that is not accepted.",
  },
  {
    file: "domain/export/rows.ts",
    text: "instagram.com",
    why: "URL parsing rule: a host the href of an export row may have.",
  },
  {
    file: "domain/export/rows.ts",
    text: "www.instagram.com",
    why: "URL parsing rule: a host the href of an export row may have.",
  },
];

/**
 * The only network calls whose target is not a quoted path on this site: the
 * request helpers of the interface, which take the path as a parameter. `call`
 * is the callee and its first argument as written. Paths relative to web/src.
 * @type {ReadonlyArray<NetworkAllowance>}
 */
export const NETWORK_ALLOWANCES = [
  {
    file: "components/admin/api.ts",
    call: "fetch(path",
    why: "getJson, the read helper of the admin screen. Its callers pass paths of this app.",
  },
  {
    file: "components/dashboard/api.ts",
    call: "fetch(path",
    why: "requestJson, the request helper of the dashboard and profile screens. Its callers pass paths of this app.",
  },
  {
    file: "components/onboarding/api.ts",
    call: "fetch(path",
    why: "callApi, the request helper of the onboarding and settings forms. Its callers pass paths of this app.",
  },
];

/**
 * The packages hosted code may import, by package name (a subpath such as
 * "next/server" belongs to "next"). Those marked `dependency` are exactly the
 * runtime dependencies in package.json, and no other runtime dependency is
 * allowed there.
 * @type {ReadonlyArray<Package>}
 */
export const PACKAGES = [
  { name: "better-auth", dependency: true, why: "OrbitDiff accounts: sign-up, sign-in, sessions, and email verification." },
  { name: "drizzle-orm", dependency: true, why: "Queries against the app's own Postgres database." },
  { name: "next", dependency: true, why: "The framework: pages, route handlers, and the proxy." },
  { name: "pg", dependency: true, why: "The Postgres driver for the app's own database." },
  { name: "react", dependency: true, why: "The interface components." },
  { name: "react-dom", dependency: true, why: "Rendering of the interface components." },
  { name: "server-only", dependency: true, why: "Marks modules that must never reach the browser." },
  { name: "zod", dependency: true, why: "Validation of request bodies and configuration." },
  { name: "tailwindcss", dependency: false, why: "The stylesheet import in app/globals.css, resolved when the app is built." },
];

/**
 * The Node modules hosted code may import. `names`, when present, are the only
 * bindings that may be imported from the module, by name.
 * @type {ReadonlyArray<Builtin>}
 */
export const BUILTINS = [
  { name: "node:crypto", why: "Hashes, random ids, and constant-time comparison of secrets." },
  { name: "node:net", why: "isIP, to read addresses in the proxy configuration. It opens no connection.", names: ["isIP", "isIPv4", "isIPv6"] },
];

/** A dot in a host name, also as it is written inside a pattern ("instagram\.com"). */
const DOT = "\\\\?\\.";

/** Hosts of Instagram, Facebook, Threads, and Meta, with any subdomain. */
const META_DOMAINS = ["instagram", "cdninstagram", "facebook", "fb", "threads", "meta"]
  .map((name) => `${name}${DOT}com`)
  .concat([`instagr${DOT}am`, `facebook${DOT}net`, `fbcdn${DOT}net`, `fb${DOT}me`, `threads${DOT}net`, `ig${DOT}me`]);

const META_NAME = `(?:[a-z0-9-]+${DOT})*(?:${META_DOMAINS.join("|")})`;

/** A Meta host as it appears in text: optional scheme, optional subdomains, optional port and path. */
const META_HOST = new RegExp(
  `(?:https?:\\/\\/)?(?<![a-z0-9-])${META_NAME}(?![a-z0-9-])` + "(?::\\d+)?(?:\\/[^\\s\"'`<>(){}\\[\\]\\\\]*)?",
  "gi",
);

/** A string that is exactly a bare Meta host: "www.instagram.com". */
const HOST_LITERAL = new RegExp(`(["'\`])(?<![a-z0-9-])${META_NAME}\\1`, "gi");

/** `const NAME = new Set([...])`, optionally exported. Group 2 is `export`, 3 the name, 4 the list. */
const SET_DECLARATION =
  /(^|[^\w$.])(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*new\s+Set\s*(?:<[^>]*>)?\s*\(\s*\[([^\]]*)\]\s*\)/g;

/** Anything that sends a request: fetch, the usual client packages, the node modules, and the browser objects. */
const NETWORK_CALL = new RegExp(
  "(?<![\\w$])(?:" +
    [
      "\\$?fetch",
      "ofetch(?:\\.\\w+)?",
      "axios(?:\\.\\w+)?",
      "got(?:\\.\\w+)?",
      "ky(?:\\.\\w+)?",
      "superagent(?:\\.\\w+)?",
      "needle(?:\\.\\w+)?",
      "https?\\.(?:get|request)",
      "undici\\.(?:fetch|request|stream)",
      "(?:net|tls)\\.(?:connect|createConnection)",
      "dgram\\.createSocket",
      "sendBeacon",
      "WebSocket",
      "EventSource",
      "XMLHttpRequest",
    ].join("|") +
    ")\\s*\\(|\\.open\\s*\\(",
  "g",
);

/** A network function used as a value, so a call through another name would escape NETWORK_CALL. */
const NETWORK_NAMES = "fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon";
const NETWORK_REFERENCE = new RegExp(`(?<![\\w$])(?:${NETWORK_NAMES})(?![\\w$])(?!\\s*\\()`, "g");
const NETWORK_LOOKUP = new RegExp(`\\[\\s*(["'\`])(?:${NETWORK_NAMES})\\1\\s*\\]`, "g");
/** Code right before or after a name, as opposed to the verb "fetch" in a sentence. */
const CODE_AROUND_BEFORE = /(?:[.=(,:[?{!]|&&|\|\||=>|\breturn|\bawait)\s*$/;
const CODE_AROUND_AFTER = /^\s*(?:[.;,)\]}]|\?\?|\|\||&&|$)/;

/** A rewrite: the configuration key or method, or the proxy's NextResponse.rewrite. */
const REWRITE = /(?<![\w$])rewrites["']?\s*[:(]|\.rewrite\s*\(/g;

/** Starting another program. `.exec(` is left alone: it is also the method of a regular expression. */
const PROCESS =
  /(?<![\w$])(?:spawn|spawnSync|execSync|execFile|execFileSync|fork|execa|execaSync)\s*\(|(?<![\w$.])exec\s*\(|child_process|(?<![\w$])Bun\s*\.\s*(?:spawn|spawnSync|\$)|(?<![\w$])Deno\s*\.\s*(?:run|Command)\b/g;

/** Package scripts that would run the local collector or the local command line tools. */
const LOCAL_TOOLS = /\borbit-os\b|-m\s+orbit(?:diff|_os)\b|\borbitdiff\s+(?:collect|login|watch)\b|instaloader/i;

/** Dependency names that look like an Instagram or Meta client, in any section of package.json. */
const CLIENT_NAMES = /insta|instagrapi|(?<![a-z])ig[-_]?(?:api|client|private)|facebook|threads|meta[-_]?graph/i;

/** Reading a file from disk. */
const FILE_READ =
  /(?<![\w$])(?:readFile(?:Sync)?|readTextFile|createReadStream|openSync|open|readFileSync|Bun\.file)\s*\(/g;

/** `import ... from "x"` and `export ... from "x"` at the start of a line. Group 2 is the specifier. */
const STATIC_IMPORT =
  /^[ \t]*(?:import|export)\s+(?:type\s+)?((?:[\w$]+\s*,\s*)?(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]*\}\s*|[\w$]+\s*))from\s*(["'])([^"'\n]*)\2/gm;
const SIDE_EFFECT_IMPORT = /^[ \t]*import\s*(["'])([^"'\n]*)\1/gm;
const STYLESHEET_IMPORT = /^[ \t]*@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1/gm;
const DYNAMIC_IMPORT = /(?<![\w$.])(?:import|require)(\s*)\(|(?<![\w$])getBuiltinModule\s*\(/g;
/** What may come right before a dynamic import that is written with a space before its parenthesis. */
const CODE_BEFORE = /(?:[=(,:?!&|{[]|=>|\bawait|\breturn|\btypeof|\bvoid)\s*$/;

const SECRET =
  "(?:password|passwd|pwd|pw|passcode|pass|secret|verification[_-]?code|security[_-]?code|login[_-]?code|" +
  "two[_-]?factor(?:[_-]?code)?|2fa(?:[_-]?code)?|totp|mfa|otp|code|cookies?|" +
  "session(?:[_-]?(?:id|cookie|token|file))?|credentials?|token)";
const OWNER = "(?:instagram|insta|ig)";

/**
 * Names written without a space: instagramPassword, ig_session_id, igPw,
 * instagram-2fa-code, passwordForInstagram. They are matched after the words
 * of a camel case name are split (see splitWords), so a name that carries on,
 * such as instagramPasswordInput, is caught too.
 */
const CREDENTIAL_NAMES = [
  new RegExp(`(?<![a-z0-9])${OWNER}[_-]?(?:account[_-]?|user[_-]?|login[_-]?)?${SECRET}(?![a-z])`, "gi"),
  new RegExp(`(?<![a-z0-9])${SECRET}[_-]?(?:for[_-]?|of[_-]?)?${OWNER}(?![a-z])`, "gi"),
];

/** instagramPasswordInput becomes instagram_Password_Input. No line break is added or removed. */
function splitWords(text) {
  return text.replace(/([a-z0-9])(?=[A-Z])/g, "$1_");
}

/** The account, as a word: Instagram, Insta, IG. */
const OWNER_WORD = /(?<![A-Za-z0-9_])(?:instagram|insta|ig)(?![A-Za-z0-9_])/i;
const OWNER_WORDS = new RegExp(OWNER_WORD.source, "gi");

/** A secret, as words in a label. */
const SECRET_WORD = new RegExp(
  "(?<![A-Za-z0-9_])(?:passwords?|passcodes?|pass code|pw|secret|verification codes?|security codes?|log-?in codes?|sign-in codes?|" +
    "one-time codes?|two-factor|2fa|otp|codes?|cookies?|session(?: ?id)?s?|log-?ins?|sign-ins?|credentials?|tokens?)(?![A-Za-z0-9_])",
  "i",
);

/** The attributes that name or label a form control. Group 1 is the attribute, group 3 the value. */
const CONTROL_ATTRIBUTE =
  /(?<![\w-])(label|legend|placeholder|aria-label|name|id|htmlFor|for|autoComplete)\s*=\s*\{?\s*(["'`])((?:(?!\2)[^\n\\]|\\.){0,300})\2/gi;

/** A label or legend element with everything inside it. Group 2 is the content. */
const LABEL_ELEMENT = /<(label|legend)\b[^>]*>([\s\S]{0,600}?)<\/\1\s*>/gi;

/** A control that takes a secret: a password or one-time code input, or a control labelled with a secret word. */
const SECRET_CONTROLS = [
  /(?<![\w-])type\s*=\s*\{?\s*["'`]password["'`]/i,
  /(?<![\w-])autoComplete\s*=\s*\{?\s*["'`](?:current-password|new-password|one-time-code)["'`]/i,
  /(?<![\w-])(?:label|placeholder|aria-label|name|id|htmlFor)\s*=\s*\{?\s*["'`][^"'`\n]*(?<![A-Za-z0-9_])(?:password|passcode|pw|secret|verification code|2fa|two-factor|otp|one-time code|cookie|session|token|credential)/i,
];

/** A word that says no. "not only" and "not just" do not. */
const NEGATION = /(?<![\w'’])(?:not(?!\s+(?:only|just|merely|simply)\b)|never|no|nothing|none|neither|nor|cannot|without|separate)(?![\w'’])|n['’]t(?![\w])/i;

/** The cookies Instagram itself sets for a signed-in browser. As a name in code, in its own case. */
const INSTAGRAM_COOKIES = /(?<![\w$])(?:sessionid|csrftoken|ds_user_id|ig_did|ig_nrcb|shbid|shbts)(?![\w$])/g;
/** The same cookie names as a quoted string, in any case. */
const QUOTED_COOKIES = /(["'`])(?:sessionid|csrftoken|ds_user_id|ig_did|ig_nrcb|shbid|shbts)\1/gi;

const SESSION_FILE_NAMES = [
  /session[_-]?file/gi,
  /(?:load|save)[_-]?session[_-]?(?:from|to)[_-]?file/gi,
  /(?<![\w$])(?:load|save)_session(?![\w$])/g,
  /["'`][^"'`\n]*\.session["'`]/g,
];

/** The collector and other Instagram client libraries, as they read with only letters and digits kept. */
const COLLECTOR_NAMES = [
  { squeezed: "instaloader", name: "instaloader", reason: "mentions instaloader: the hosted app never imports, runs, or refers to the local collector" },
  { squeezed: "instagrapi", name: "instagrapi", reason: "mentions instagrapi, an Instagram client library: the hosted app never collects from Instagram" },
  { squeezed: "igapiclient", name: "IgApiClient", reason: "mentions IgApiClient, an Instagram client library: the hosted app never collects from Instagram" },
  {
    squeezed: "instagramprivateapi",
    name: "instagram-private-api",
    reason: "mentions instagram-private-api, an Instagram client library: the hosted app never collects from Instagram",
  },
];

/** Claims, as pairs of words in either order with at most a short run of prose between them. */
const AUTO = "(?<![\\w-])(?:automatic(?:ally)?|automated|auto)(?!\\w)";
const LIVE = "(?<![\\w-])(?:real[\\s-]*time|realtime|live)(?!\\w)";
const TRACK = "(?<!\\w)track(?:s|ed|ing|er|ers)?(?![\\w-])";
const GAP = "[^.!?;<>{}()\\[\\]=|&*/\\\\\"`]{0,80}?";
const CLAIMS = [
  { pattern: new RegExp(`${AUTO}${GAP}${TRACK}|${TRACK}${GAP}${AUTO}`, "gi"), phrase: "automatic tracking" },
  { pattern: new RegExp(`${LIVE}${GAP}${TRACK}|${TRACK}${GAP}${LIVE}`, "gi"), phrase: "real-time tracking" },
  { pattern: new RegExp(`${TRACK}${GAP}(?<!\\w)(?:from|on|via|through)\\s+(?:instagram|insta|ig)(?!\\w)`, "gi"), phrase: "tracking from Instagram" },
  {
    pattern: /(?<![\w-])production[\s-]+(?:ready|grade)(?!\w)|(?<![\w-])(?:ready|grade)\s+(?:for|in)\s+(?:[\w-]+\s+){0,3}?production(?!\w)/gi,
    phrase: "production-ready",
  },
];

/** Where a clause ends: sentence and clause punctuation, markup, code, and the words that join clauses. */
const CLAUSE_BREAK = /[.!?;:,<>{}()[\]"`]|(?<![\w-])(?:and|but|so|while|because|although|though|yet|or)(?![\w-])/gi;
/** A predicate that takes the claim back: "is unavailable", "is not supported". */
const DENIED_AFTER =
  /^\s*(?:[\w'’-]+\s+){0,6}?(?:is|are|was|were|stays|remains)\s+(?:not\s+(?:available|supported|offered|possible|provided|included)|unavailable|unsupported)(?!\w)/i;
/** A denial inside the pair: "tracking is not automatic", "tracks followers, but not automatically". */
const DENIED_INSIDE = /(?<!\w)(?:is|are|was|were|be|stays|remains)\s+(?:not|never)(?!\w)|n['’]t(?!\w)|(?<!\w)(?:not|never)\s+\S+$/i;

/** Extensions that hold bytes, not text. They are reported in src, and accepted as images and fonts in public. */
const NOT_TEXT = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|pdf|zip|gz|mp4|webm|wasm)$/i;
const PUBLIC_BINARY = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot)$/i;

/** The configuration files of an app directory that decide what runs on the platform. */
const CONFIG_FILES = ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs", "vercel.json"];

function lineOf(text, index) {
  let line = 1;
  for (let at = text.indexOf("\n"); at !== -1 && at < index; at = text.indexOf("\n", at + 1)) line += 1;
  return line;
}

/** The text between the parenthesis at `open` and the one that closes it, bounded. */
function argumentsAt(text, open) {
  let depth = 0;
  const limit = Math.min(text.length, open + 4_000);
  for (let at = open; at < limit; at += 1) {
    const character = text[at];
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, at);
    }
  }
  return text.slice(open + 1, limit);
}

/** The first argument of an argument list, as written. */
function firstArgument(args) {
  let depth = 0;
  let quote = "";
  for (let at = 0; at < args.length; at += 1) {
    const character = args[at];
    if (quote) {
      if (character === "\\") at += 1;
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'" || character === "`") quote = character;
    else if ("([{".includes(character)) depth += 1;
    else if (")]}".includes(character)) depth -= 1;
    else if (character === "," && depth === 0) return args.slice(0, at).trim();
  }
  return args.trim();
}

function allMatches(pattern, text) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)];
}

/** A Meta host as written, without the punctuation that ends the sentence around it. */
function hostText(match) {
  return match[0].replace(/[.,;:!?]+$/, "");
}

function namesMetaHost(text) {
  return allMatches(META_HOST, text).length > 0;
}

/**
 * True when the first argument of a call is a quoted path on this site, such
 * as "/api/me". The first character after the slash must be a letter, digit,
 * underscore, or hyphen, so "//host" and "/\host" are not paths, and nothing
 * in it may be interpolated.
 */
function callsThisSite(args) {
  return /^\s*(["'`])\/[A-Za-z0-9_-][^"'`$\n]*\1\s*(?:,|$)/.test(args);
}

/**
 * The text with every `"a" + "b"` joined into `"ab"`, and a function from a
 * line of the joined text to the line of the original where it starts. Views
 * derived from the joined text keep its line breaks, so they share the map.
 */
function joinPieces(text) {
  const join = /(["'`])[ \t\r\n]*\+[ \t\r\n]*(["'`])/g;
  let out = "";
  let line = 1;
  const starts = [1];
  let last = 0;
  const copy = (from, to) => {
    for (let at = from; at < to; at += 1) {
      out += text[at];
      if (text[at] === "\n") {
        line += 1;
        starts.push(line);
      }
    }
  };
  for (const match of text.matchAll(join)) {
    copy(last, match.index);
    for (const character of match[0]) if (character === "\n") line += 1;
    last = match.index + match[0].length;
  }
  copy(last, text.length);
  return { text: out, line: (joinedLine) => starts[joinedLine - 1] ?? 1 };
}

/** Only the letters and digits of a text, lowercased, with the index each one had. */
function squeeze(text) {
  let out = "";
  const origin = [];
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    const upper = code >= 65 && code <= 90;
    if (upper || (code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      out += upper ? String.fromCharCode(code + 32) : text[at];
      origin.push(at);
    }
  }
  return { text: out, origin };
}

const blank = (value) => value.replace(/[^\n]/g, " ");

/**
 * The text as a reader sees the copy: JSX spaces such as {" "}, no-break
 * spaces, and inline markup such as <strong> become spaces. Every replacement
 * keeps the length, so indexes and lines stay the same.
 */
function proseView(text) {
  return text
    .replace(/\{\s*(["'`])\s*\1\s*\}/g, blank)
    .replace(/&(?:nbsp|ensp|emsp|thinsp|#160|#x0*a0|#8194|#8195|#8201|#8239|#x202f);/gi, blank)
    .replace(/\\u00a0|\\xa0|\\u202f/gi, blank)
    .replace(/[   ]/g, " ")
    .replace(
      /<\/?(?:a|abbr|b|bdi|bdo|br|cite|code|data|dfn|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var|wbr)(?:\s[^<>]*)?\/?>/gi,
      blank,
    )
    .replace(/<\/?>/g, blank);
}

/** The sentence around an index: bounded by sentence ends, markup, code braces, quotes, and blank lines. */
function sentenceAround(view, index) {
  const limit = 400;
  const boundary = (at) => {
    const character = view[at];
    if ("<>{}\"`".includes(character)) return true;
    if (".!?".includes(character) && /\s/.test(view[at + 1] ?? " ")) return true;
    if (character === "\n" && /^\n[ \t]*\n/.test(view.slice(at, at + 40))) return true;
    return view.startsWith("*/", at) || view.startsWith("/*", at);
  };
  let start = index;
  while (start > 0 && index - start < limit && !boundary(start - 1)) start -= 1;
  let end = index;
  while (end < view.length && end - index < limit && !boundary(end)) end += 1;
  return view.slice(start, end);
}

/** The clause before an index, from the last clause break. */
function clauseBefore(view, index) {
  const before = view.slice(Math.max(0, index - 200), index);
  let cut = 0;
  for (const match of before.matchAll(CLAUSE_BREAK)) cut = match.index + match[0].length;
  return before.slice(cut);
}

/** The clause after an index, up to the next clause break. */
function clauseAfter(view, index) {
  const after = view.slice(index, index + 200);
  CLAUSE_BREAK.lastIndex = 0;
  const match = CLAUSE_BREAK.exec(after);
  return match ? after.slice(0, match.index) : after;
}

/** True when the clause of a claim says it is not so. */
function claimDenied(view, match) {
  const end = match.index + match[0].length;
  return NEGATION.test(clauseBefore(view, match.index)) || DENIED_INSIDE.test(match[0]) || DENIED_AFTER.test(clauseAfter(view, end));
}

/** The reason an import specifier is not allowed, or null when it is. */
function importProblem(file, specifier, bindings) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const target = posix.normalize(posix.join(posix.dirname(file), specifier));
    return target === ".." || target.startsWith("../")
      ? `imports "${specifier}", a file outside the hosted source`
      : null;
  }
  if (specifier.startsWith("@/")) return null;
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  if (specifier.startsWith("node:") || builtinModules.includes(bare) || builtinModules.includes(bare.split("/")[0] ?? "")) {
    const builtin = BUILTINS.find((entry) => entry.name === `node:${bare}`);
    if (!builtin) return `imports the Node module "${specifier}", which is not listed in BUILTINS`;
    if (builtin.names) {
      const names = /^\{([^}]*)\}\s*$/.exec((bindings ?? "").trim());
      const imported = names
        ? names[1]
            .split(",")
            .map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim() ?? "")
            .filter(Boolean)
        : null;
      if (!imported || imported.some((name) => !builtin.names?.includes(name))) {
        return `imports from "${specifier}" more than ${builtin.names.join(", ")}`;
      }
    }
    return null;
  }
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return PACKAGES.some((entry) => entry.name === name) ? null : `imports "${specifier}", which is not a listed package`;
}

/**
 * Check one hosted source file.
 * @param {string} file Path relative to the hosted source root, with forward slashes.
 * @param {string} text The content of the file.
 * @returns {Finding[]} Findings in line order.
 */
export function checkFile(file, text) {
  /** @type {Finding[]} */
  const findings = [];
  const seen = new Set();
  const joined = joinPieces(text);
  const source = joined.text;
  /** Record a finding at a line of the original text. */
  const addLine = (line, rule, reason) => {
    const key = `${line}\u0000${rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file, line, rule, reason });
  };
  /** Record a finding at an index of the joined text, or of a view with the same lines. */
  const add = (index, rule, reason, view = source) => addLine(joined.line(lineOf(view, index)), rule, reason);
  /** Record a finding at an index of the original text. */
  const addRaw = (index, rule, reason) => addLine(lineOf(text, index), rule, reason);

  // The collector and other client libraries, also when the name is joined from pieces.
  const squeezed = squeeze(source);
  for (const { squeezed: needle, reason } of COLLECTOR_NAMES) {
    for (let at = squeezed.text.indexOf(needle); at !== -1; at = squeezed.text.indexOf(needle, at + 1)) {
      const origin = squeezed.origin[at] ?? 0;
      if (origin > 0 && /[A-Za-z0-9]/.test(source[origin - 1] ?? "")) continue;
      add(origin, "collector", reason);
    }
  }

  // Imports: literal names only, and only what is listed.
  const checkImport = (index, specifier, bindings) => {
    const problem = importProblem(file, specifier, bindings);
    if (problem) addRaw(index, "import", `${problem}: hosted code imports only its own files and the listed packages`);
  };
  for (const match of allMatches(STATIC_IMPORT, text)) checkImport(match.index, match[3], match[1]);
  for (const match of allMatches(SIDE_EFFECT_IMPORT, text)) checkImport(match.index, match[2], undefined);
  for (const match of allMatches(STYLESHEET_IMPORT, text)) checkImport(match.index, match[2], undefined);
  for (const match of allMatches(DYNAMIC_IMPORT, text)) {
    if (match[1]) {
      // `import (` with a space is prose unless code comes right before it.
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      if (!CODE_BEFORE.test(text.slice(lineStart, match.index))) continue;
    }
    const args = argumentsAt(text, match.index + match[0].length - 1);
    const literal = /^\s*(["'`])([^"'`$\n]*)\1\s*(?:,[\s\S]*)?$/.exec(args);
    if (!literal) {
      addRaw(match.index, "import", "has a dynamic import or require whose argument is not one quoted string, so what it loads cannot be checked");
    } else {
      checkImport(match.index, literal[2], undefined);
    }
  }

  for (const match of allMatches(PROCESS, source)) {
    add(match.index, "process", `starts another program ("${match[0].slice(0, 30)}"): the hosted app never runs the local tools or any other program`);
  }

  for (const pattern of SESSION_FILE_NAMES) {
    for (const match of allMatches(pattern, source)) {
      add(match.index, "session-file", `names a saved session file ("${match[0].slice(0, 40)}"): the hosted app never loads one`);
    }
  }
  for (const match of allMatches(FILE_READ, source)) {
    const args = argumentsAt(source, match.index + match[0].length - 1);
    if (/session/i.test(args)) {
      add(match.index, "session-file", "reads a file whose path names a session: the hosted app never loads a session file");
    }
  }

  // Instagram secrets: names, labels in either order, and secret controls beside an unqualified mention of the account.
  const credential = "the hosted app never asks for a password, code, cookie, or session for Instagram";
  const words = splitWords(source);
  for (const pattern of CREDENTIAL_NAMES) {
    for (const match of allMatches(pattern, words)) {
      add(match.index, "instagram-credential", `has a field or variable for an Instagram secret ("${match[0].slice(0, 40)}"): ${credential}`, words);
    }
  }
  const prose = proseView(source);
  const asksForSecret = (value) => {
    const words = value.replace(/<[^>]*>/g, " ").replace(/\{\s*(["'`])\s*\1\s*\}/g, " ").replace(/&nbsp;/gi, " ");
    return OWNER_WORD.test(words) && SECRET_WORD.test(words);
  };
  for (const match of allMatches(CONTROL_ATTRIBUTE, source)) {
    if (asksForSecret(match[3])) {
      add(match.index, "instagram-credential", `has a form control whose ${match[1]} asks for an Instagram secret: ${credential}`);
    }
  }
  for (const match of allMatches(LABEL_ELEMENT, source)) {
    if (asksForSecret(match[2])) {
      add(match.index, "instagram-credential", `has a ${match[1].toLowerCase()} that asks for an Instagram secret: ${credential}`);
    }
  }
  const secretControl =
    SECRET_CONTROLS.some((pattern) => pattern.test(source)) ||
    allMatches(LABEL_ELEMENT, source).some((match) => SECRET_WORD.test(match[2].replace(/<[^>]*>/g, " ")));
  if (secretControl) {
    for (const match of allMatches(OWNER_WORDS, prose)) {
      if (!NEGATION.test(sentenceAround(prose, match.index))) {
        add(
          match.index,
          "instagram-credential",
          `names ${match[0]} in a file that holds a password or code control, in a sentence that does not say it is not asked for: ${credential}`,
          prose,
        );
      }
    }
  }
  for (const pattern of [INSTAGRAM_COOKIES, QUOTED_COOKIES]) {
    for (const match of allMatches(pattern, source)) {
      add(
        match.index,
        "instagram-credential",
        `names an Instagram cookie ("${match[0].slice(0, 20)}"): the hosted app never holds a cookie or session for Instagram`,
      );
    }
  }

  // Requests: a Meta host is never a target, and every other target is a quoted path on this site.
  const hosts = allMatches(META_HOST, source);
  const allowedHere = new Set(ALLOWANCES.filter((entry) => entry.file === file).map((entry) => entry.text));
  const helpersHere = new Set(NETWORK_ALLOWANCES.filter((entry) => entry.file === file).map((entry) => entry.call));
  for (const match of allMatches(NETWORK_CALL, source)) {
    const args = argumentsAt(source, match.index + match[0].length - 1);
    const callee = match[0].replace(/[\s(]/g, "").replace(/^\./, "");
    if (namesMetaHost(args)) {
      add(match.index, "meta-request", "sends a request to an Instagram, Facebook, Threads, or Meta host: the hosted app never contacts them");
    } else if (callsThisSite(args)) {
      continue;
    } else if (hosts.length > 0) {
      add(
        match.index,
        "meta-request",
        "sends a request from a file that names an Instagram or Facebook host, and the target is not a quoted path on this site",
      );
    } else if (!helpersHere.has(`${callee}(${firstArgument(args)}`)) {
      add(
        match.index,
        "request",
        `sends a request whose target ("${firstArgument(args).slice(0, 40)}") is not a quoted path on this site, outside the listed request helpers`,
      );
    }
  }

  for (const match of allMatches(NETWORK_REFERENCE, source)) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const lineEnd = source.indexOf("\n", match.index);
    const before = source.slice(lineStart, match.index);
    const after = source.slice(match.index + match[0].length, lineEnd === -1 ? source.length : lineEnd);
    if (CODE_AROUND_BEFORE.test(before) || CODE_AROUND_AFTER.test(after)) {
      add(match.index, "request", `uses ${match[0]} as a value, so the target of a call through it cannot be checked`);
    }
  }
  for (const match of allMatches(NETWORK_LOOKUP, source)) {
    add(match.index, "request", "looks up a network function by a quoted name, so the target of the call cannot be checked");
  }

  // Meta hosts: only the listed allowances, and a bare host only inside a host set that is asked .has() and nothing else.
  for (const match of hosts) {
    const written = hostText(match);
    if (!allowedHere.has(written)) {
      add(match.index, "meta-host", `names an Instagram or Facebook host ("${written.slice(0, 60)}") that is not a listed allowance for this file`);
    }
  }
  const sets = allMatches(SET_DECLARATION, source)
    .filter((match) => allMatches(HOST_LITERAL, match[4]).length > 0)
    .map((match) => {
      const start = match.index + match[1].length;
      return { name: match[3], exported: Boolean(match[2]), start, end: match.index + match[0].length };
    });
  for (const literal of allMatches(HOST_LITERAL, source)) {
    if (!sets.some((set) => literal.index >= set.start && literal.index < set.end)) {
      add(literal.index, "meta-host", `holds the bare host ${literal[0]} outside a host set: a bare host may only be asked whether it matches`);
    }
  }
  for (const set of sets) {
    if (set.exported) add(set.start, "meta-host", `exports the host set ${set.name}: it may only be asked .has() inside its own file`);
    const uses = new RegExp(`(?<![\\w$])${set.name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
    for (const use of allMatches(uses, source)) {
      if (use.index >= set.start && use.index < set.end) continue;
      if (/^\s*\.\s*has\s*\(/.test(source.slice(use.index + set.name.length))) continue;
      add(use.index, "meta-host", `uses the host set ${set.name} for something other than .has(): its hosts must not leave the check`);
    }
  }

  for (const match of allMatches(REWRITE, source)) {
    add(match.index, "rewrite", "rewrites a path of this site to another target: a path here must never answer with another host");
  }

  for (const { pattern, phrase } of CLAIMS) {
    for (const match of allMatches(pattern, prose)) {
      if (claimDenied(prose, match)) continue;
      add(
        match.index,
        "claim",
        `makes the claim "${match[0].replace(/\s+/g, " ").slice(0, 50)}" (${phrase}), which the capability matrix does not allow`,
        prose,
      );
    }
  }

  const order = new Map(RULES.map((rule, index) => [rule.id, index]));
  return findings.sort((a, b) => a.line - b.line || (order.get(a.rule) ?? 0) - (order.get(b.rule) ?? 0));
}

/**
 * Check a package.json: its runtime dependencies, the names in every
 * dependency section, the commands of its scripts, and its text as a file.
 * @param {string} file The name to report, such as "package.json".
 * @param {string} text
 * @returns {Finding[]}
 */
export function checkPackage(file, text) {
  /** @type {Finding[]} */
  const findings = checkFile(file, text);
  const at = (needle) => {
    const index = text.indexOf(needle);
    return index === -1 ? 1 : lineOf(text, index);
  };
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return [{ file, line: 1, rule: "dependency", reason: "is not valid JSON, so its dependencies cannot be checked" }];
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [{ file, line: 1, rule: "dependency", reason: "is not a JSON object, so its dependencies cannot be checked" }];
  }
  const sections = ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies", "dependenciesMeta", "overrides", "resolutions"];
  const runtime = new Set(PACKAGES.filter((entry) => entry.dependency).map((entry) => entry.name));
  for (const section of sections) {
    const names = manifest[section] && typeof manifest[section] === "object" ? Object.keys(manifest[section]) : [];
    for (const name of names) {
      if (CLIENT_NAMES.test(name)) {
        findings.push({ file, line: at(`"${name}"`), rule: "dependency", reason: `depends on "${name}", a name like an Instagram or Meta client` });
      } else if (["dependencies", "optionalDependencies", "peerDependencies"].includes(section) && !runtime.has(name)) {
        findings.push({ file, line: at(`"${name}"`), rule: "dependency", reason: `has the runtime dependency "${name}", which is not listed in PACKAGES` });
      }
    }
  }
  const scripts = manifest.scripts && typeof manifest.scripts === "object" ? manifest.scripts : {};
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command === "string" && LOCAL_TOOLS.test(command)) {
      findings.push({ file, line: at(`"${name}"`), rule: "process", reason: `has the script "${name}", which runs the local collector or command line tools` });
    }
  }
  const order = new Map(RULES.map((rule, index) => [rule.id, index]));
  return findings.sort((a, b) => a.line - b.line || (order.get(a.rule) ?? 0) - (order.get(b.rule) ?? 0));
}

/** Every entry under a directory, as paths relative to the root with forward slashes. */
function walk(root, directory, found) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(root, path, found);
    else found.push(relative(root, path).split(sep).join("/"));
  }
  return found;
}

/** The files under a directory, sorted, or none when it cannot be read. */
function filesUnder(root) {
  try {
    return walk(root, root, []).sort();
  } catch {
    return [];
  }
}

/**
 * Read a file as text for the gate, or say why it cannot be checked.
 * @returns {{ text: string } | { reason: string }}
 */
function readText(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return { reason: "is missing, so it cannot be checked" };
  }
  if (!stat.isFile()) return { reason: "is a link or a special file, which could point outside the app: it was not checked" };
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
  } catch {
    return { reason: "is not valid UTF-8 text, so it cannot be checked" };
  }
  if (text.includes("\u0000")) return { reason: "holds a NUL byte, so it is not text and cannot be checked" };
  return { text };
}

/**
 * Check every file under the hosted source root.
 * @param {string} root
 * @returns {{ files: number, findings: Finding[] }}
 */
export function checkTree(root) {
  const files = filesUnder(root);
  if (files.length === 0) {
    return {
      files: 0,
      findings: [{ file: ".", line: 1, rule: "empty-tree", reason: "holds no file to check: a wrong path must not pass the gate" }],
    };
  }
  /** @type {Finding[]} */
  const findings = [];
  for (const file of files) {
    if (NOT_TEXT.test(file)) {
      const stat = lstatSync(join(root, ...file.split("/")));
      findings.push({
        file,
        line: 1,
        rule: "unreadable",
        reason: stat.isFile()
          ? "is not a text file, so it cannot be checked: keep images and fonts in public/, not in the hosted source"
          : "is a link or a special file, which could point outside the hosted source: it was not checked",
      });
      continue;
    }
    const read = readText(join(root, ...file.split("/")));
    if ("reason" in read) findings.push({ file, line: 1, rule: "unreadable", reason: read.reason });
    else findings.push(...checkFile(file, read.text));
  }
  return { files: files.length, findings };
}

/**
 * Check an app directory: src/, public/, the configuration files, and package.json.
 * Findings name files relative to the app directory.
 * @param {string} web
 * @returns {{ files: number, findings: Finding[] }}
 */
export function checkApp(web) {
  /** @type {Finding[]} */
  const findings = [];
  const source = checkTree(join(web, "src"));
  let files = source.files;
  for (const finding of source.findings) findings.push({ ...finding, file: finding.file === "." ? "src" : `src/${finding.file}` });

  const unreadable = (file, reason) => findings.push({ file, line: 1, rule: "unreadable", reason });

  for (const name of CONFIG_FILES) {
    try {
      lstatSync(join(web, name));
    } catch {
      continue;
    }
    files += 1;
    const read = readText(join(web, name));
    if ("reason" in read) unreadable(name, read.reason);
    else findings.push(...checkFile(name, read.text));
  }

  for (const file of filesUnder(join(web, "public"))) {
    const name = `public/${file}`;
    const path = join(web, "public", ...file.split("/"));
    files += 1;
    if (PUBLIC_BINARY.test(file) && lstatSync(path).isFile()) continue;
    const read = readText(path);
    if ("reason" in read) unreadable(name, read.reason);
    else findings.push(...checkFile(name, read.text));
  }

  files += 1;
  const manifest = readText(join(web, "package.json"));
  if ("reason" in manifest) unreadable("package.json", `${manifest.reason}: without it the dependencies cannot be checked`);
  else findings.push(...checkPackage("package.json", manifest.text));

  const order = new Map(RULES.map((rule, index) => [rule.id, index]));
  findings.sort(
    (a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line || (order.get(a.rule) ?? 0) - (order.get(b.rule) ?? 0),
  );
  return { files, findings };
}

/**
 * One finding as a line of output.
 * @param {Finding} finding
 * @param {string} [label] How a tree root is named in the output, for example "src". Without it the file is printed as it is.
 */
export function formatFinding(finding, label) {
  const path = label === undefined ? finding.file : finding.file === "." ? label : `${label}/${finding.file}`;
  return `${path}:${finding.line}: [${finding.rule}] ${finding.reason}`;
}

function main(args) {
  const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let result;
  let label;
  if (args[0] === "--app") {
    if (!args[1]) {
      console.log("usage: node scripts/check-hosted-rules.mjs [--app <dir> | <dir>]");
      return 2;
    }
    result = checkApp(resolve(args[1]));
  } else if (args[0] !== undefined) {
    const root = resolve(args[0]);
    result = checkTree(root);
    label = basename(root);
  } else {
    result = checkApp(web);
  }
  const { files, findings } = result;
  const noun = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (findings.length === 0) {
    console.log(`hosted rules: ${noun(files, "file")} checked, no findings`);
    return 0;
  }
  for (const finding of findings) console.log(formatFinding(finding, label));
  console.log(`hosted rules: failed, ${noun(findings.length, "finding")} in ${noun(files, "file")}`);
  return 1;
}

/**
 * True when this file is the program node was asked to run. Both sides are
 * compared as real paths, so a start through a linked directory still runs
 * the check instead of exiting 0 without output.
 */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = main(process.argv.slice(2));
}
