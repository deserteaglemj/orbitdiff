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

## 7. Account screens and onboarding

Added with the account phase. No new tokens and no new base components: everything below is built from sections 2 and 3.

### Routes

| Path | Route file | Screen component |
| --- | --- | --- |
| `/sign-up` | `src/app/(auth)/sign-up/page.tsx` | `SignUpScreen` in `src/components/auth/sign-up-screen.tsx` |
| `/sign-in` | `src/app/(auth)/sign-in/page.tsx` | `SignInScreen` |
| `/verify-email` | `src/app/(auth)/verify-email/page.tsx` | `VerifyEmailScreen` (states `waiting`, `opened`, `invalid`) |
| `/forgot-password` | `src/app/(auth)/forgot-password/page.tsx` | `ForgotPasswordScreen` |
| `/reset-password` | `src/app/(auth)/reset-password/page.tsx` | `ResetPasswordScreen` |
| `/onboarding` | `src/app/(app)/onboarding/page.tsx` | `OnboardingFlow` in `src/components/onboarding/onboarding-flow.tsx` |

A page file is an async server component that reads the query and the server state, then renders a synchronous screen component with plain props. Keep that split: the screen components are what `tests/unit/screens/markup.test.ts` renders.

### Parts (`src/components/auth/`)

| Part | Use |
| --- | --- |
| `AuthFrame` (`auth-parts.tsx`) | `title`, `lead`, `children`, `aside`. The `h1` comes from `PageHeader`. The form sits in a 28rem column; `aside` becomes a second column from 1024px and follows the form below that. Put anything that must be read before typing above the form, not in `aside`. |
| `CapturedMailNotice` | Required wherever an account message is mentioned on a deployment that captures mail. |
| `TextLink`, `TEXT_LINK` | Inline link with a 24px tap height. |
| `SignOutButton` | The `signOutButton` of `AppShell`. |
| `SuspendedScreen` | What the signed-in layout renders for a suspended account. |
| `EmailRequestForm` | One email field and one button, for a new confirmation message or a reset message. |
| `loadPage(path)` (`navigate.ts`) | Full navigation after the login state changed. Use it instead of `router.push` after sign-in, sign-out, sign-up, a password reset, and the last onboarding step. |
| `useBrowserTimezone()` | The browser timezone without a hydration mismatch. |
| `listTimezones()`, `timezoneOptions()` | The timezone list comes from the server, so the list offered is the list the server accepts. |

Rules of the forms live in pure modules with tests: `sign-up-model.ts` (validation, the request body), `password-strength.ts`, `auth-errors.ts` (what to show for a refusal), `src/components/onboarding/model.ts` (which documents need a tick, the onboarding body), and `src/components/onboarding/api.ts` (the error envelope of the JSON routes).

### Form conventions used by every account form

- `noValidate` on the form and validation in the submit handler, so every message appears under its field (`error` prop) in the app's own words. On a failed submit, focus moves to the first field with an error.
- `FormError` above the submit button for a failure that belongs to no field. A result that is not a failure goes in an element with `role="status"` that is mounted from the start.
- The submit button uses `loading` and `loadingLabel`; the fields are `disabled` while the request runs.
- Consent: one required box for the Terms and the Privacy notice at sign-up, a separate optional box for product news, never pre-ticked. `acceptedTermsVersion` is sent only when the required box is ticked. `marketingOptIn` is sent as a boolean. In onboarding, a box is shown only for a document whose recorded consent is missing, withdrawn, or not the current version (`consentToConfirm`).
- A refusal from a JSON route is shown with the route's own message (`describeApiFailure`). A refusal from `/api/auth/*` goes through `describeAuthError`.
- No account screen has a field about an Instagram login.

### Signed-in pages

`src/app/(app)/layout.tsx` calls `resolvePageAccess(await headers(), pathname)` from `src/server/auth/page-access.ts` and then redirects, renders `SuspendedScreen`, or renders `AppShell`. A layout is not rendered again on a client-side navigation, so every page under `(app)` calls `resolvePageAccess` (or the guards) itself before it loads data, as `onboarding/page.tsx` does.

Destinations come from `src/server/auth/paths.ts`: `safeNextPath`, `signInPath`, `afterSignInPath`. Never navigate to a value from the query without `safeNextPath`.

### Registration and mail state on a screen

Read it on the server with `readPublicRegistration()` from `src/server/auth/public-state.ts`. It reports what `GET /api/health` reports (the answer of the sign-up gate), never throws, and returns `open: false` with a reason when the deployment is not configured, when no operator is named, when mail cannot be handled, and at capacity. Show the form only for `open === true`.

The legal pages render `OperatorStatement` (`src/app/legal/operator-statement.tsx`) with `readOperatorName()`. Nothing about the operator is written anywhere else.

### Content Security Policy

`src/proxy.ts` sets a policy with a nonce that is new for every request. Consequences for every page:

- No `style` attribute in markup and no inline `<script>`. Use classes. `tests/unit/screens/markup.test.ts` fails on a `style` attribute in an account screen.
- No script, font, image, or request from another origin.
- A page has to be rendered per request to receive the nonce. The `(auth)` and `legal` layouts call `await connection()`; the `(app)` layout reads `headers()`. A page outside those layouts needs one of the two.

### Checks

```
corepack yarn vitest run --project unit tests/unit/screens tests/unit/server
corepack yarn vitest run --project integration tests/integration/auth
```

`tests/integration/auth/screens-contract.test.ts` drives the real Better Auth client and the real routes with the bodies the forms build.

## 8. Account screens: rules added after review

These add to section 7. Where the two differ, this section is the current rule.

### Focus after a failed submit

The fields are `disabled` while a request runs, and a disabled control cannot take focus. A submit handler therefore never calls `focus()` itself: at that moment the fields are still disabled and the message is not in the document yet.

- `useFocusAfterSubmit(formRef, !pending)` from `src/components/auth/use-focus-after-submit.ts` returns a function. Call it from the handler with `fieldTarget(name)` for a field with an error, or with `SUBMIT_TARGET` for a failure that belongs to no field. Focus moves after the render that enables the fields and shows the message, so the message is read out with its field (`aria-invalid` and `aria-describedby` are already set).
- `firstFieldWithError(order, errors)` picks the first field in screen order. Keep one `FIELD_ORDER` list per form with the `name` attributes in the order they appear.
- A field that is not on the screen, or is still disabled, cannot take focus. The submit button takes it instead, so focus is never left on the page body. Every form has exactly one `type="submit"` button (`markup.test.ts` checks it).
- A failure without a field is shown in `FormError` (`role="alert"`) and focus returns to the submit button.
- The rule itself is in `src/components/auth/focus-request.ts`, a pure module, and is tested in `tests/unit/screens/focus-request.test.ts`. There is no DOM test environment, so the hook is only as thin as it can be. Check a changed form by hand in a browser: submit with Enter from a field, let the server refuse (for example a wrong access code), and confirm that focus lands on that field.

### Consent names the version that was shown

Consent is recorded at the version the request names, never at a version the server fills in.

- Sign-up: the page passes `termsVersion` and `privacyVersion` to `SignUpScreen`. The form prints both next to the agreement box and sends them as `acceptedTermsVersion` and `acceptedPrivacyVersion`, only when the box is ticked (`buildSignUpRequest(values, shown)`).
- The sign-up gate accepts `acceptedPrivacyVersion` as an optional field. When it is sent it must be the current version of the Privacy notice, compared in full. When it is not sent, the one version the request names stands for both documents, which holds only while it is also the current version of the Privacy notice. Every other state answers 422 `PRIVACY_NOT_ACCEPTED`, and `describeAuthError` puts it on the agreement box.
- Onboarding: the page passes `versions` to `OnboardingFlow`. The agreement step sends `{ termsVersion, privacyVersion }` with those values (`buildOnboardingBody`), and `consentToConfirm(consent, versions)` decides which boxes to show. No acceptance flag is sent.
- A page that was open while a document changed is refused by the server. `describeAgreementRefusal` says which document changed and asks for a reload. It does not show the field names of the request.
- Checks: `tests/integration/auth/consent-versions.test.ts` holds one probe per invalid state (missing, empty, not text, fabricated, outdated, padded, the other document's version, marketing in place of acceptance) and the stale page probes for sign-up and onboarding.

### Redirect targets

A value is a path on this site only after it has been resolved the way a browser resolves it. `/.//host`, `/a/..//host`, and `/%2e//host` start with one slash and still lead to another host.

- `isSitePath(value)` in `src/server/auth/paths.ts` is the one test. The auth gate uses it for `callbackURL`, `redirectTo`, `errorCallbackURL`, and `newUserCallbackURL`, in the body and in the query.
- `withErrorCode(path, code)` builds a failure redirect from the resolved path. It cannot return a value that starts with two slashes. A value that is not a site path becomes `/?error=<code>`.
- `safeNextPath` stays the function for a destination after sign-in. It also refuses API routes.
- Checks: `tests/unit/server/site-path.test.ts` and `tests/integration/auth/open-redirect.test.ts`.

### Pages and the nonce: the check

`tests/unit/server/per-request-pages.test.ts` walks `src/app` and fails when a `page.tsx` or `not-found.tsx` has no request API (`await connection()`, `await headers()`, `await cookies()`, an awaited `searchParams`, or `dynamic = "force-dynamic"`) in the file itself or in a layout above it. A comment that mentions one does not count. A page that reaches a request API only through a helper needs its own `await connection()` to pass.

## 9. Settings and admin screens

No new tokens and no new base components. Everything is built from sections 2 and 3 and follows the form conventions of sections 7 and 8.

### Routes

| Path | Route file | Screen component |
| --- | --- | --- |
| `/settings` | `src/app/(app)/settings/page.tsx` (with `loading.tsx`) | `SettingsScreen` in `src/components/settings/settings-screen.tsx` |
| `/admin` | `src/app/(app)/admin/page.tsx` | `AdminScreen` in `src/components/admin/admin-screen.tsx` |

Both pages call the guards themselves and the services with the user id the guards returned: `getMe` and `listProfiles` for settings, `getCapacity` and `listUsers` for admin.

### Settings: parts (`src/components/settings/`)

| Part | Use |
| --- | --- |
| `ProfileForm`, `ReviewSchedule` (`profile-form.tsx`) | Display name, timezone, review hour through `PATCH /api/me`. The timezone is a native select narrowed by a search field above it. The schedule lists the stored next review of each profile. |
| `MarketingForm` | The product news choice through `POST /api/me/consent`, with the recorded state, time, and version. |
| `ConsentRecord` | The recorded Terms and Privacy notice consent. Read only: no control and no form. |
| `SecuritySection`, `PasswordForm`, `SessionsPanel`, `SessionsTable` | Change password, sign out, sign out of all other devices, and the list of logins with a sign-out for each. All through the auth client. |
| `DataSection` | The download link to `GET /api/account/export` and the usage against each quota. |
| `DeleteAccountForm` | The danger section. Password field, then a `ConfirmDialog`, then `authClient.deleteUser`. |
| `RouteRefreshProvider`, `useRouteRefresh()` (`refresh-context.tsx`) | After a save a form calls `refresh()`, which is `router.refresh()` in a transition. The server renders the page again, so the usage, the next review times, and the name in the header show the stored state. Outside the provider `refresh()` does nothing, which is what lets the markup tests render a screen without the app router. |

### Helpers (pure, tested in `tests/unit/account/`)

| Function | Result |
| --- | --- |
| `formatBytes(bytes)` (`settings/format.ts`) | `"512 bytes"`, `"1.5 KB"`, `"20 MB"`. 1 KB is 1,024 bytes, as in the Terms. `"Unknown"` for a missing size, never zero. |
| `formatDateTime(iso, timeZone?)` | `"30 Sep 2026, 14:05 (Europe/Berlin)"`. Falls back to UTC, and says UTC, for a zone the runtime does not know. |
| `quotaState(used, limit)` | `{ level, label, tone, remaining }` with level `ok`, `near` (from 80 percent), `reached`, or `unknown`. A reached quota is a paused state: its tone is `warning`, never `danger`. |
| `documentConsentSummary`, `marketingSummary` (`settings/consent-summary.ts`) | The wording of the consent log. A record is granted only for the boolean `true`, and current only when the version equals the current one in full. |
| `buildMarketingRequest(choice, shownVersion)`, `describeMarketingRefusal(failure)` | The body of the product news request, and what to show when it is refused. |
| `buildTimezoneList(current, intl?)`, `filterTimezones(zones, query, selected)` (`settings/timezones.ts`) | The zones to offer and the search over them. |
| `buildDeletionRequest(password)`, `deleteAccount(call, password)` (`settings/deletion.ts`) | The gate in front of account deletion and the outcome to show. |
| `validatePasswordChange`, `describeSecurityError`, `sessionRows`, `describeUserAgent` (`settings/security.ts`) | The rules of the Security section. |
| `capacityItems(capacity, now)` (`admin/capacity.ts`) | The six readings of the capacity report, each with its state in words and `paused: true` when it pauses something. |
| `adminUserRow`, `adminUsersPath`, `loadUsers`, `readUsersPage`, `describeResultCount` (`admin/users.ts`) | The accounts table: one row in words, the address of a page of the route, and the check of what the route answered. |

### Rules

- **Product news is a separate choice.** `buildMarketingRequest` sends `{ granted: true, version }` for a grant and `{ granted: false }` for a withdrawal, and nothing else. The choice must be a boolean: `"true"`, `"on"`, `1`, and a missing value build no request. A grant names the version the page was rendered with (`versions.marketing` from the page), never one looked up when sending. A withdrawal needs no version, so turning product news off always works. The form shows the state the server returned, never the state it hoped for.
- **Account deletion fails closed.** `deleteAccount` builds a request only for a password that is text and not empty, and it is asked twice: when the form is submitted (the dialog does not open without a password) and again when the dialog is confirmed. Nothing is sent otherwise. The account counts as deleted only when the server answers `success: true`. A refusal is shown with the server's own message followed by "Your account was not deleted." On success the browser loads `/` with a full navigation (`loadPage`).
- **Session tokens never reach the markup.** The list of logins is read in the browser through `authClient.listSessions()` after the page is open, so no token is part of the page the server sends. `SessionsTable` renders the device name, the address, and the times. The device name comes from a fixed list of words (`describeUserAgent`); the browser description itself is chosen by the device and is never shown.
- **The list of logins needs a recent sign-in.** Better Auth answers `SESSION_NOT_FRESH` for a login older than one day. The section then says so and keeps "Sign out of all other devices" available.
- **Changing the password signs every other device out.** `buildPasswordChangeRequest` always sets `revokeOtherSessions: true`.
- **A reached quota is a paused state.** `DataSection` shows it with a badge in words and a notice that names what is paused and what ends the pause. Nothing leads to a paid tier.
- **The timezone list comes from the server.** The page calls `buildTimezoneList(me.timezone)`, which reads `Intl.supportedValuesOf("timeZone")` and falls back to a fixed list of common zones when the runtime cannot list its own. The current value is always offered and always stays in the filtered list.
- **Focus after a successful save** returns to the submit button, next to the `role="status"` line that says what was saved. The fields were disabled during the request, which drops focus otherwise.

### Admin

- `src/app/(app)/admin/page.tsx` calls `requireAdmin(await headers())` and calls `notFound()` for everyone else. There is no "forbidden" page. The admin services run only after the guard passed.
- `generateMetadata` returns the title of the not-found page for everyone but the admin, so the title gives nothing away either. Do not give this page a static `metadata` title.
- Do not add a `loading.tsx` to the admin segment. A streamed response is sent with status 200, so the not-found page could no longer answer 404.
- The first page of accounts comes with the screen. Search and the other pages are read from `GET /api/admin/users` by `UsersPanel`, which keeps the last good list next to a failure.
- The screen is read only: its only controls search the accounts and page through them. It shows no password, token, roster, or Instagram username, and `adminUserRow` builds a row field by field so nothing else can reach the page.
- Times on the admin screen are UTC. Times on the settings screen are in the account's own timezone.

### Checks

```
corepack yarn vitest run --project unit tests/unit/account
corepack yarn vitest run --project integration tests/integration/api/screens-settings.test.ts tests/integration/api/screens-pages.test.ts
```

`screens-settings.test.ts` sends what the settings forms build to the real routes and to the real Better Auth client. `screens-pages.test.ts` calls the two page functions the way Next.js does, with only `headers()` from `next/headers` replaced by the headers of the visitor each test describes. Neither replaces a browser: check the forms by hand at 360px and 1440px, including focus after a refused submit and the dialog in front of account deletion.

## 10. Workspace: dashboard, profile, import

Added with the workspace phase. No new tokens and no new base components: everything below is built from sections 2 and 3.

### Routes

| Path | Route file | Screen |
| --- | --- | --- |
| `/dashboard` | `src/app/(app)/dashboard/page.tsx` (with `loading.tsx`) | `DashboardScreen` in `src/components/dashboard/dashboard-screen.tsx` |
| `/profiles` | `src/app/(app)/profiles/page.tsx` | Redirects to the dashboard |
| `/profiles/[id]` | `src/app/(app)/profiles/[id]/page.tsx` | `ProfileScreen` in `src/components/profile/profile-screen.tsx`, one section per `?tab=` |
| `/profiles/[id]/import` | `src/app/(app)/profiles/[id]/import/page.tsx` | `ImportFlow` in `src/components/import/import-flow.tsx` |

Every page calls `workspaceUser()` (`src/components/dashboard/workspace-access.ts`), which asks the guards and redirects exactly as the layout does. The user id it returns is the only user id a page hands to a service.

### Not found is decided before anything is streamed

`loadOwnedProfile(id)` in `src/app/(app)/profiles/[id]/load.ts` is the one way a profile page gets its profile. A malformed id, an id that does not exist, and an id of another account all end in `notFound()`, and `src/app/(app)/profiles/[id]/not-found.tsx` renders the same page for the three. The check runs before any `Suspense` boundary, so the response status is 404. For that reason there is no `loading.tsx` under `profiles/[id]`: a loading file would start the stream and turn the status into 200. The sections load behind a `Suspense` boundary below the header instead. `generateMetadata` uses the same memoized call, so a foreign id never gets a profile title.

### State lives in the address

Tabs, search text, filters, and the page number are query parameters, read by pure functions in `src/components/dashboard/query.ts` (`readPage`, `readChoice`, `readSearch`, `buildHref`). A value the page does not know is ignored and never fails the page. The activity filter `profile` is accepted only for one of the user's own profile ids.

`FilterForm` (`src/components/dashboard/filter-form.tsx`) is a GET form on `next/form`: it works without scripts and keeps the scroll position with them. Give it a `key` built from the current values, so its uncontrolled fields follow the address after a link changed it.

### Models (pure, tested in `tests/unit/workspace/`)

| Module | What it decides |
| --- | --- |
| `dashboard/local-time.ts` | `formatLocalTime(iso, zone)` gives `20 Sep 2026, 12:00 (America/Chicago)`: every time on these screens names its timezone. `localInputToIso(value, zone)` turns the value of a date and time control into an ISO string with that timezone's offset. |
| `dashboard/card-model.ts` | `profileCard(profile, extras)`: the evidence badge, the counts (`null` stays "Unknown"), the source line, coverage wording ("declared by you"), the times, and the processing, failure, and paused states. `profileFailure` reports a failure only while no later job has succeeded, and always as two statements: the failure and the last success. |
| `dashboard/activity-model.ts` | The feed rows (the wording itself comes from the service), the filter options, `readActivityQuery`, `activityHref`. |
| `dashboard/api.ts` | `requestJson` for the JSON routes. `describeRefusal` keeps the route's message and adds the remaining cooldown or the local time a daily limit starts again. |
| `profile/rows.ts` | `triState` (Yes, No, Unknown), `changeRow` and `observedInterval` ("Observed in your export between A and B (zone)"), `changesState` (no import, undated, baseline, pending, none observed, no match, list), `snapshotRow`, `countRows`, the tabs, `removalDescription`. |
| `import/model.ts` | `classifySelection` (what is read and what is ignored, before any content is loaded), `parseSelection` (the domain rule `parseExportFiles` with the hosted limits), `summarizeImport`, `readCaptureInput`, `coveragePreview`, `buildImportRequest`, `describeReceipt`, `processingOutcome`, `importQuota`. |

### Rules

- A client module (`"use client"`) exports components only. A constant that a server component needs lives in a plain module: a server component that imports a value from a client module gets a reference, not the value. `ADD_PROFILE_FIELD_ID` is in `card-model.ts` for that reason.
- A workspace page shows `observedInterval`, which carries the two capture times with the timezone. `observedBetween` from section 3 stays the wording for dates only. Both read "observed in your export between".
- The differences list calls a row "New in followers list" or "Gone from followers list". It never says follow, unfollow, or a point in time, and each row carries the badge "Export observation".
- A count trend and the net change wording come from the count history of the service. No component turns a count into usernames.
- After a mutation through the JSON API the screen calls `router.refresh()`. Removing a profile uses `loadPage("/dashboard")`, so nothing rendered for the removed profile stays on screen.
- While an import is processed, `ProcessingWatcher` and `ImportFlow` ask `GET /api/profiles/:id` every two seconds, at most 45 times, and announce the result in a `role="status"` region that is mounted from the start.
- The import reads only files the domain rule would recognize. Everything else in a chosen folder is listed as ignored and its content is never loaded. A ZIP is handed to the domain rule as it is.
- The capture time field is a date and time control labelled with the account timezone. What is sent is shown under it as an ISO string with the offset.

### Checks

```
corepack yarn vitest run --project unit tests/unit/workspace
```

In a browser, at 360px and 1440px: add a profile, import a first export (the receipt says baseline and the Changes section has no rows), import a later one (the rows read "Observed in your export between"), then sign in as another account and open the first account's profile address (the not-found page, status 404). A Suspense boundary of a freshly loaded page is revealed on an animation frame, so a tab that is not visible keeps the loading state until it is shown.

## 11. `/admin`: who gets which answer

This section replaces two earlier sentences: "`/admin` answers 404 to everyone else" in section 4, and the first bullet under Admin in section 9. Both describe what the page function does. What a visitor gets is decided in three places, in the order of the table. `/admin` is one of the signed-in areas, so the proxy and the signed-in layout treat it as they treat `/settings`.

| Visitor | Decided by | Answer |
| --- | --- | --- |
| No session cookie | The proxy (`signInRedirect` in `src/server/auth/paths.ts`) | Redirect to `/sign-in?next=%2Fadmin` |
| A session cookie that is not a valid session (forged, revoked, expired) | The signed-in layout (`resolvePageAccess`) | Redirect to `/sign-in?next=%2Fadmin` |
| Signed in, address not verified | The signed-in layout | Redirect to `/verify-email` |
| Signed in, suspended | The signed-in layout | The suspended notice in place of the page, status 200, titled "Account suspended" |
| Signed in, not onboarded or consent not current, the admin included | The signed-in layout | Redirect to `/onboarding` |
| Signed in, verified, active, onboarded, not the admin | The page (`requireAdmin`, then `notFound()`) | The not-found page, status 404, titled "Page not found" |
| The admin | The page | The admin screen, titled "Admin" |

- The 404 is the answer for a signed-in, verified, active, onboarded account that is not the admin. There is no "forbidden" page.
- The first five answers differ from the answer for an address that does not exist, so they show that `/admin` is a page of this app. That is no secret: the route is named in this repository. None of them carries admin data. `getCapacity` and `listUsers` run only after `requireAdmin` passed, and they check the admin's id again themselves.
- `/api/admin/*` has no proxy redirect and no layout in front of it: those routes answer 404 to everyone but the admin, signed in or not.
- On a navigation inside the app the layout is not rendered again, so the page function answers alone: `notFound()` for every request that does not pass `requireAdmin`, and onboarding for an admin who is not onboarded. Keep the guard in the page.
- A deployment that is not configured has no accounts. The proxy still sends a request without a session cookie to `/sign-in?next=%2Fadmin`, and the layout sends every other request to `/sign-in`.
- The title comes from `adminMetadata(visitor)` in `src/components/admin/page-metadata.ts`: "Admin" for the admin only, "Account suspended" for the suspended notice, and the title of the not-found page for everyone else, including a value the function does not know. `generateMetadata` asks `resolvePageAccess` whether the layout shows the suspended notice, so the title cannot disagree with the layout.
- `docs/web/design.md` section 7 has the short form: "Everyone else gets 404 on `/admin` and `/api/admin/*`". It holds as written for `/api/admin/*`. For `/admin` it holds for an account that reaches the page, which is the sixth row. The rows above it are answered first.

### Checks

```
corepack yarn vitest run --project unit tests/unit/account/admin-access.test.ts tests/unit/server/proxy.test.ts tests/unit/server/paths.test.ts
corepack yarn vitest run --project integration tests/integration/auth/page-access.test.ts tests/integration/api/screens-pages.test.ts
```

`admin-access.test.ts` pins the title rule, and it pins the table above to the proxy's own decision (`signInRedirect`) and to the path constants, so a change to either fails until this section is changed with it. `proxy.test.ts` and `paths.test.ts` pin `/admin` as a signed-in area. `page-access.test.ts` pins what the layout does with `/admin` for a suspended account and for an account that is not onboarded.

`screens-pages.test.ts` calls the page function alone. Its cases for a visitor who is not signed in, for a forged cookie, for a suspended admin, and for an account that is not onboarded show what the page answers by itself, as on a navigation inside the app. They do not show what a full page load of `/admin` ends in: the table does.

## 12. Workspace: a stale export, and the page tests

This section adds to section 10. Where the two differ, this one holds: the `card-model.ts` row of the models table there still says "the evidence badge", and the check there lists the unit command only.

### Age is decided apart from coverage

The evidence status the service returns (`ProfileDto.evidence`) is `degraded` for every export with a direction that is not complete, whatever its age, and the profile data carries no stale flag of its own. One declaration box left unticked is enough for that, so the status alone would never call such an export stale while the count of the complete direction is still shown. The interface therefore decides the age itself, in `src/components/dashboard/card-model.ts`:

| Function | What it decides |
| --- | --- |
| `exportAge(profile, now)` | `none` before the first import, `undated` without a capture time, `stale` once the capture time is more than `LIMITS.staleAfterMs` (36 hours) back, otherwise `fresh`. The same rule as the `stale` flag of `buildView` in `src/domain/export/snapshot.ts`. |
| `staleNote(profile, now)` | The sentence about the age, or `null`. An undated export is stale and is never given an age: its sentence says the capture time is missing. A status of `stale` from the service stands even when the clock of the page would disagree. |
| `statusBadges(profile, now)`, `statusNotes(profile, now)` | The evidence badge and note, and "Stale" with its sentence next to them when the evidence status does not say so itself. An old export with incomplete coverage reads "Incomplete coverage" and "Stale". |
| `staleBanner(cards)` | The banner above the dashboard cards: every profile whose export is stale, whatever its coverage. |

- The clock is a parameter. `profileCard` takes it as `extras.now` and `ProfileScreen` as the `now` prop. The dashboard page hands in the `now` it gave `listProfiles`; `loadOwnedProfile` reads the profile with one `now` and returns it. Evidence and age are judged at the same instant that way. Do not call `new Date()` in a model or a screen.
- `now` is a `Date` and stays on the server: `profileCard` turns it into a boolean, badges, and sentences before anything reaches a client component.
- `ProfileCardModel` has `badges` and `notes` (lists) in place of one badge and one note. `stale` is true for an old or undated export at any coverage.
- A profile page shows the stale notice and the coverage notice as two notices when both apply.

### Page tests

`tests/unit/workspace/pages.test.ts` calls the dashboard page, the profile page, the import page, both `generateMetadata` functions, `loadOwnedProfile`, and `workspaceUser` the way Next.js does, as two accounts, with only `headers()` from `next/headers` replaced. It pins:

- a foreign profile id, a well-formed id of nothing, and malformed ids all end in the not-found error, for the page and for the title, and cannot be told apart;
- no title carries a handle for anyone but the owner, a suspended owner included;
- the dashboard shows the visitor's own cards and feed, and drops a `?profile=` that names another account's profile, names nothing, or is malformed;
- a visitor who is not signed in is sent to sign-in, an account that is not onboarded to onboarding, and a suspended account gets nothing from the page;
- an old export with one direction not declared complete is marked stale on the dashboard and on the profile page, from the import to the markup.

The file lives under `tests/unit` with the other workspace tests, and the unit project starts no database. It brings its own through `tests/unit/workspace/support/database.ts`, which reuses `tests/setup/global-db.ts` and `tests/setup/integration-env.ts`: one throwaway Postgres for the file, never `TEST_DATABASE_URL`. It adds a few seconds to the unit run. `tests/unit/workspace/screens.test.ts` renders `ProfileCard`, `DashboardScreen`, and `ProfileScreen` to markup with `renderScreen` from `support/render.ts`, which supplies the router context the client components ask for.

`workspaceUser()` reads the requested path through `requestedPathname()`, as the signed-in layout does. A path header on a request that did not come through the proxy is ignored, so it cannot choose the page sign-in returns to.

```
corepack yarn vitest run --project unit tests/unit/workspace
```
