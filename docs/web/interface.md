# OrbitDiff Web: interface reference

For engineers building screens in `web/`. Read `docs/web/design.md` for the contract and `docs/web/capability-matrix.md` for what the copy may claim. This page covers the tokens, the components, and the page layout conventions.

## 1. Identity

- One theme: light text on the navy ground of the OrbitDiff mark. There is no light mode and no theme switch.
- The mark is `web/public/orbitdiff-mark.svg` (also the favicon). `Logo` and `LogoMark` in `src/components/logo.tsx` draw the same shapes inline. Do not redraw or recolour it.
- Product name in text: "OrbitDiff Web". Font: the system sans stack. No web fonts.
- Never reuse the local app claims that the product is local by nature or that data stays on the device. They are true for the local app and false for a hosted one.

## 2. Tokens

Defined once, in `web/src/app/globals.css`, inside `@theme static`. The default Tailwind palette is removed (`--color-*: initial`), so `bg-zinc-900`, `text-white`, and similar classes do not exist. Use the names below: `bg-surface`, `text-muted`, `border-edge`, and so on.

| Token | Value | Derived from | Use |
| --- | --- | --- | --- |
| `ground` | `#111827` | brand | Page background. Text colour on every accent fill. |
| `ink` | `#f8fafc` | brand | Text. Focus ring. |
| `blue` | `#60a5fa` | brand | Primary action, links, info. |
| `amber` | `#fbbf24` | brand | Attention: warning. |
| `green` | `#34d399` | brand | Positive: ok. |
| `surface` | `#1f2634` | ink 6% into ground | Cards and panels. |
| `raised` | `#2a313e` | ink 11% into ground | Hover, nested or emphasised card, skeleton. |
| `line` | `#3b414d` | ink 18% into ground | Decorative separators and card borders. Default border colour. |
| `edge` | `#797e87` | ink 45% into ground | Borders that identify a control: inputs, secondary buttons. |
| `muted` | `#a0a4ab` | ink 62% into ground | Secondary text, placeholders. |
| `blue-tint` | `#1a2940` | blue 12% into ground | Fill behind info content. |
| `amber-tint` | `#2d2c27` | amber 12% into ground | Fill behind warning content. |
| `green-tint` | `#152e35` | green 12% into ground | Fill behind ok content. |
| `blue-bright` | `#7eb6fa` | ink 20% into blue | Hover for primary buttons and links. |
| `danger` | `#fbbf24` | alias of amber | Danger text, border, and fill. |
| `danger-tint` | `#443d26` | amber 22% into ground | Fill behind danger content. |

Danger has no hue of its own, because the palette is limited to the five brand colours. It is told apart from warning by weight and by words: a danger badge is filled, a danger notice has a thick border and the label "Problem", a field error starts with "Error:". To give danger its own hue later, change `--color-danger` and `--color-danger-tint` and nothing else.

Decorative accent borders use an opacity modifier, for example `border-blue/50`.

### Contrast

`web/tests/unit/components/tokens.test.ts` evaluates the token values from `globals.css` and fails when a pair drops below WCAG AA. Add a pair to that test before using a new combination.

| Text on background | Ratio |
| --- | --- |
| ink on ground, surface, raised | 16.96, 14.49, 12.49 |
| ink on blue-tint, amber-tint, green-tint, danger-tint | 13.99, 13.37, 13.62, 10.34 |
| muted on ground, surface, raised | 7.09, 6.06, 5.22 |
| blue on ground, surface, raised, blue-tint | 6.98, 5.96, 5.14, 5.76 |
| blue-bright on ground, surface, raised | 8.41, 7.19, 6.20 |
| amber (and danger) on ground, surface, raised, amber-tint | 10.63, 9.08, 7.83, 8.38 |
| danger on danger-tint | 6.48 |
| green on ground, surface, raised, green-tint | 9.23, 7.89, 6.80, 7.41 |
| ground on blue, blue-bright, amber, green, ink | 6.98, 8.41, 10.63, 9.23, 16.96 |
| edge on ground, surface, raised (non-text, needs 3.0) | 4.35, 3.72, 3.20 |

Rules that follow from the numbers:

- Text on a blue, amber, or green fill is always `text-ground`. Ink on blue is 2.43 and fails.
- `muted` text goes on `ground`, `surface`, or `raised` only. On a tint use `text-ink`.
- `line` (1.73 on ground) is decoration. A border that a control depends on uses `edge`.
- The focus ring is 2px ink with a 2px offset, set globally on `:focus-visible`. Do not remove it and do not put `overflow-hidden` on the direct parent of a focusable element.

### Type, shape, motion

- Sans: `ui-sans-serif, system-ui, sans-serif`. Mono (`font-mono`): usernames, handles, digests, file names.
- Sizes in use: page title `text-2xl sm:text-3xl` bold, section heading `text-xl` semibold, body `text-base`, supporting text `text-sm`, badges `text-xs`. Form controls are 16px so iOS does not zoom.
- Numbers that change or line up use `tabular-nums`.
- Radius: controls `rounded-lg`, cards and notices `rounded-xl`, badges `rounded-full`.
- Motion: colour transitions and the spinner only. `prefers-reduced-motion` turns them off globally.
- Layering: only the skip link uses `z-50`. The dialog is in the browser's top layer.

## 3. Components

Import from `@/components/ui` unless a path is given. Every component takes `className` for layout (margin, width, grid placement). Do not pass a colour or padding class that the component already sets: there is no class merging, so the winner would be arbitrary. Use the `tone` or `variant` prop instead.

### Actions

| Component | Props | Notes |
| --- | --- | --- |
| `Button` | `variant` (`primary`, `secondary`, `quiet`, `danger`; default `secondary`), `size` (`md` 40px, `lg` 48px), `fullWidth`, `loading`, `loadingLabel`, plus every `button` attribute | Client component. `type` defaults to `button`; set `type="submit"` in forms. `loading` keeps the width and the focus, shows a spinner, sets `aria-busy`, and ignores clicks. `disabled` is the native attribute. |
| `LinkButton` | `href`, `variant`, `size`, `fullWidth`, `aria-label` | Navigation that looks like a button. Internal paths use the router; `http`, `https`, and `mailto` render a plain anchor. |
| `buttonClasses(style)` | `{ variant, size, fullWidth }` | The class string, for the rare element that is neither. |

One primary button per view. Use `danger` only for an action that cannot be undone, behind a `ConfirmDialog`.

### Forms

| Component | Props | Notes |
| --- | --- | --- |
| `TextField` | `label` (required), `hint`, `error`, `id`, `inputClassName`, plus every `input` attribute | Label above, hint and error below. `hint` and `error` are wired with `aria-describedby`; `error` sets `aria-invalid`. `required` adds "(required)" to the label. Always pass `name` and `autoComplete`. |
| `SelectField` | `label`, `hint`, `error`, `options` (`{ value, label, disabled? }[]`) or `children`, plus every `select` attribute | Native select. |
| `CheckboxField` | `label`, `hint`, `error`, plus every checkbox `input` attribute | 24px box, 40px row. Use one per consent: terms, privacy, and marketing are separate boxes and marketing is never pre-checked. |
| `FieldHint`, `FieldError` | `id`, `children` | For custom controls. Reference the id from `aria-describedby`. |
| `FormError` | `children` | Form-level failure, `role="alert"`. Renders nothing when empty. Place it above the submit button. |

Never use a placeholder as a label. Never ask for an Instagram password, code, cookie, or session in any field.

### Surfaces and status

| Component | Props | Notes |
| --- | --- | --- |
| `Card` | `tone` (`surface`, `raised`, `ground`, `blue`), `as` (`div`, `section`, `article`, `li`), `padded` | Use when grouping shows hierarchy. Plain spacing is often enough. |
| `Panel` | `title`, `description`, `actions`, `headingLevel` (2 or 3), `padded` | Card with a header. It is a labelled region named by its title. |
| `Badge` | `tone` (`ok`, `warning`, `danger`, `neutral`, `info`), `children` (required text) | The text states the status. Colour only supports it. |
| `Notice` | `tone` (`info`, `warning`, `danger`), `title`, `children`, `actions`, `label`, `live` | Banner. Shows "Note", "Warning", or "Problem" before the title. Set `live` when it appears after load so it is announced. |
| `EmptyState` | `title`, `description`, `action`, `headingLevel` | Say why it is empty and offer the one action that fills it. |
| `Skeleton` | `label`, `lines`, `children` | Loading placeholder with `role="status"` and a hidden label. Build custom shapes from `SkeletonBlock`. Match the height of the loaded content. |
| `Spinner` | `label`, `showLabel`, `decorative` | Indeterminate progress with a label. |
| `LiveRegion` | `children`, `assertive`, `visuallyHidden` | Announces the result of an async action. Keep it mounted and change its content. |
| `ConfirmDialog` | `open`, `title`, `description`, `children`, `confirmLabel`, `cancelLabel`, `tone` (`primary`, `danger`), `busy`, `onConfirm`, `onCancel` | Client component on the native `dialog`. Controlled by the parent. Escape and a click outside call `onCancel`. Focus returns to the element that opened it. |

A failed job is shown with its own `Notice tone="danger"` or `Badge tone="danger"` next to the last successful result. It never replaces that result.

### Data

| Component | Props | Notes |
| --- | --- | --- |
| `DataTable` | `caption` (required), `captionHidden` | Wraps `DataTableHead` and `DataTableBody`. |
| `DataTableHead`, `DataTableHeaderCell` | `align` (`left`, `right`) | One header row. |
| `DataTableBody`, `DataTableRow` | | |
| `DataTableCell` | `label` (required, the column name), `rowHeader`, `align` | Below 640px each row becomes a block and each cell shows its `label`, so the page never scrolls sideways. |
| `Pagination` | `page`, `totalPages`, `hrefFor(page)` or `onPageChange(page)`, `label` | Links in server components, buttons in client components. Shows "Page X of Y" on a phone and numbered pages from 640px. Renders nothing for one page. |
| `StatTile` | `label`, `value` (`number`, `string`, or `null`), `hint`, `tone` (`surface`, `ground`) | `null` renders "Unknown", never zero. |
| `StatGrid` | `columns` (2 or 4) | Two across on a phone. |
| `Sparkline` | `points` (`{ label, value }[]`), `width`, `height`, `summary`, `showSummary` | Plain SVG. The drawing is hidden from assistive technology; a generated sentence carries the same data. |

When a list is empty, render `EmptyState` instead of an empty table.

### Helpers

| Function | Result |
| --- | --- |
| `formatCount(value)` | `"50,000"`, or `"Unknown"` for `null`, `undefined`, or a value that is not finite. |
| `formatDate(iso, timeZone?)` | `"1 Sep 2026"` in the given IANA timezone (default UTC). Same output on the server and in the browser. |
| `observedBetween(startIso, endIso, timeZone?)` | `"observed in your export between 1 Sep 2026 and 8 Sep 2026"`. Use it for every export difference. |
| `sparklineGeometry`, `sparklineSummary`, `paginationItems` | The pure logic behind `Sparkline` and `Pagination`. |
| `cx(...)`, `describedBy(...)`, `isExternalHref(href)` | Class joining, `aria-describedby` building, link classification. |

Count changes are worded "Net growth of N", "Net decline of N", or "No net change" by `describeNetChange` in `src/domain/counts.ts`. The interface never turns a count into names.

### Page frame (`src/components/`)

| Component | File | Props | Notes |
| --- | --- | --- | --- |
| `SkipLink` | `page-frame.tsx` | | Rendered once by the root layout. Do not add another. |
| `MainContent` | `page-frame.tsx` | `children`, `className` | The page's only `main` and the skip link target (`id="main-content"`). |
| `Container` | `page-frame.tsx` | `children`, `className` | Page width: 1152px at most, 16px gutters on a phone. |
| `SiteHeader`, `SiteFooter` | `site-header.tsx`, `site-footer.tsx` | | Public pages. |
| `AppShell` | `app-shell.tsx` | `user: { name, email }`, `isAdmin`, `signOutButton`, `children` | Signed-in pages. Links to `/dashboard`, `/settings`, and `/admin` when `isAdmin`. Includes `MainContent` and a `Container`. |
| `NavLink` | `nav-link.tsx` | `href`, `children` | Client component. Sets `aria-current="page"`. |
| `CapabilityNotice` | `capability-notice.tsx` | `className` | Required on the dashboard and on every profile page. |
| `IDENTITY_SOURCE` | `capability-copy.ts` | | Not a component: the two sentences about what Instagram allows. The landing page, the terms, and `CapabilityNotice` all render this constant. |
| `LegalDocument` | `legal-document.tsx` | `title`, `version`, `summary`, `sections` | Privacy and terms layout. |
| `Logo`, `LogoMark` | `logo.tsx` | `href`, `size` | |

## 4. Page layout conventions

Public page (landing, legal, sign in, sign up, verify, reset):

```tsx
<>
  <SiteHeader />
  <MainContent>
    <Container className="py-10">...</Container>
  </MainContent>
  <SiteFooter />
</>
```

Signed-in page: a layout renders `AppShell` once and each page returns its content.

```tsx
<AppShell user={{ name, email }} isAdmin={isAdmin} signOutButton={<SignOutButton />}>
  <PageHeader title="Dashboard" description="..." actions={...} />
  <CapabilityNotice className="mt-6" />
  ...
</AppShell>
```

- `isAdmin` only decides whether the link is shown. The server decides access: `/admin` answers 404 to everyone else.
- The root layout sets `lang`, the viewport, the theme colour, and the skip link. Pages set `export const metadata = { title: "Settings" }`; the template adds "| OrbitDiff Web".
- One `h1` per page, from `PageHeader`. Sections use `SectionHeading` or `Panel` at level 2, and level 3 inside them. Do not skip a level.
- Every data view has six states: loading (`Skeleton`), empty (`EmptyState`), stale (`Notice tone="warning"`), failed (`Notice tone="danger"` beside the last good result), paused (`Notice tone="info"` with the reason), and processing (`Badge tone="info"` or `Spinner`).
- Layout works from 360px to 1440px. Stack columns below `lg`. Use `min-w-0` on flex and grid children that hold usernames. Nothing may make the page scroll sideways.
- Touch targets are at least 40px high for buttons and navigation and 24px for inline controls.
- `src/app/error.tsx` is the error boundary for every route. Its button calls `retry()`. `src/app/not-found.tsx` is the 404 page.

## 5. Wording

Follow "Wording rules for the interface" in `docs/web/capability-matrix.md`.

- Never write that OrbitDiff Web tracks followers automatically, as changes happen, or from Instagram. State that automatic identity tracking is unavailable.
- Never write that Instagram offers no authorized way to list followers or following: the export the owner requests is one. The claim is limited to collection by an app. Use `IDENTITY_SOURCE` from `src/components/capability-copy.ts` instead of retyping it.
- Never write that OrbitDiff Web sends email or that an address is proven to belong to the user. No deployment can deliver mail. Account messages are stored instead of sent where registration is open, and the operator can read them.
- Do not call a field optional when the server rejects a request without it. The display name is required at sign-up.
- Export differences read "observed in your export between DATE and DATE" (`observedBetween`).
- Count changes read "net growth of N" or "net decline of N". A count never names accounts.
- Coverage is "declared by you", never "verified".
- A value the evidence does not support is "Unknown", never 0 and never a dash.
- No U+2014 character anywhere.

## 6. Checks

```
corepack yarn vitest run --project unit tests/unit/components
corepack yarn lint
corepack yarn typecheck
```

The component tests cover the token contrast table, the sparkline geometry and summary, the pagination entries, and the formatters. `copy.test.ts` renders the landing page, the privacy notice, the terms, and `CapabilityNotice` to static markup and checks the claims listed under Wording. Layout is checked in the browser at 360px and 1440px.
