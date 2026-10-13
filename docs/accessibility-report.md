# Accessibility report — Phase 7

The implementation follow-up to [docs/spec/11-accessibility.md](spec/11-accessibility.md).
That document scoped concrete requirements against the fleet table, alert
list, filters, and metric chart; this phase closed the gaps found by
re-reading every screen against it, then verified the result with real tool
runs rather than a one-off manual pass — no invented score, no WCAG
conformance claim, just what was built and what was actually run against it.

## What changed

- **Focus**: a shared `--focus-ring` token and a global `:focus-visible`
  baseline (`apps/web/src/app/globals.css`) cover every link and button that
  previously had no visible focus indicator (nav links, in-content links,
  the metric-chart time-range buttons, the error-state Retry button) — only
  filter inputs and table sort buttons had one before. The token gets a
  lighter dark-mode value since the light-mode color drops from ~5.9:1 to
  ~3.6:1 contrast against the dark background otherwise.
- **Landmarks and navigation**: a skip link (with a real, focusable target —
  see the note below), `<main>`, `aria-label="Primary"` on `<nav>`, and a
  per-route page `<title>` on every screen so Next's built-in route
  announcer has something route-specific to say on navigation.
- **Focus management on error states**: `ErrorState` focuses itself on
  mount, so Retry is one Tab away instead of requiring a tab-in from the
  top of the page.
- **Non-color cues**: the fleet table's active-alert count now pairs an
  aria-hidden icon with the number (matching the existing
  `StatusBadge`/`SeverityBadge` icon+text pattern), not color and weight
  alone.
- **Live regions**: alert-status announcements are now throttled and
  coalesced (`lib/use-live-announcer.ts`) instead of firing once per event
  with no batching, and connection-state changes (reaching "lost",
  recovering from it) are announced too — alert-detail.tsx had neither a
  live region nor a connection indicator before this phase.
- **Chart alternatives**: a text summary (point count, time span, min/max,
  latest value) next to the existing threshold note, and a collapsible,
  lazy-rendered accessible `<table>` of the full series as an alternative to
  the uPlot canvas.
- **Reduced motion**: a `prefers-reduced-motion` baseline in `globals.css`
  (the app's only transition, the skip link's reveal, plus whatever's added
  next).

## Two real findings, from actually running the tools

Both surfaced by wiring `@axe-core/playwright` into the E2E suite, and both
fixed rather than suppressed:

1. **`scrollable-region-focusable`** (WCAG 2.1.1/2.1.3, axe severity
   "serious"): the metric chart's points-table scroll wrapper
   (`max-height` + `overflow-y: auto`) had no keyboard way to reach its own
   scroll. Fixed with `tabIndex={0}` + `role="region"` + an `aria-label`.
2. **A live-region/visible-badge text collision**: the connection-lost
   announcement ("Live updates paused.") was an exact substring of the
   visible connection badge's text ("Live updates paused") — a redundant
   double-announcement for a screen-reader user, and concretely what broke
   the existing `realtime-reconnection.spec.ts`'s `getByText` locator into a
   strict-mode ambiguity once both existed in the DOM at once. Reworded to
   "Live updates are paused; the page still shows the last data it
   received." — related wording, no longer a substring collision.

## Automated coverage added

- Testing Library: focus-on-mount (`resource-status.test.tsx`), the
  non-color icon cue (`fleet-overview.test.tsx`), throttled/coalesced live
  regions (`alerts-list.test.tsx`, new `alert-detail.test.tsx`), the chart's
  text summary and lazy-rendered table (new `metric-chart.test.tsx`), and
  the throttle/connection-announcement logic in isolation with fake timers
  (new `use-live-announcer.test.ts`, `realtime-client.test.ts`).
- Playwright: a keyboard-only pass through the existing primary journey
  (`e2e/keyboard-navigation.spec.ts` — Tab/Enter only, no `.click()`),
  checking the skip link's real focus target and a visible `:focus-visible`
  outline on a tabbed-to link.
- `@axe-core/playwright` scanning all six MVP screens, WCAG 2 A/AA rules
  only (`e2e/accessibility.spec.ts`), including the metric chart's points
  table in its opened state.

## What was actually run to verify this, and the result

Every command below was run for real against this repo, not assumed:

| Command | Result |
|---|---|
| `pnpm --filter @opslens/web lint` / `typecheck` / `test` | pass (8 test files, 32 tests) |
| `pnpm --filter @opslens/api lint` / `typecheck` / `test` | pass (4 test files, 11 tests) |
| `pnpm --filter @opslens/api test:integration` (real Postgres) | pass (2 test files, 7 tests) |
| `pnpm --filter @opslens/web test:e2e` (full Playwright suite) | pass (7 tests: the two pre-existing specs, the new keyboard-only pass, and 4 axe scans) |
| `pnpm build` (root, matching CI's `checks` job) | pass |

## Deliberately not done this phase

- **Fleet/alerts table sorting** stays unwired — `DataTable`'s sort-button/
  `aria-sort` machinery already exists and is keyboard-operable, but no
  screen actually turns it on; that's a product decision (nothing in this
  phase's scope asked for a sort feature), not an accessibility gap, so
  nothing here claims sorting works end-to-end.
- **Contrast auditing beyond the focus-ring token** — colors used elsewhere
  in the app (status/severity badges, error banners) were not individually
  re-measured against WCAG's 4.5:1/3:1 thresholds this phase; only the new
  `--focus-ring` token's contrast was actually computed and adjusted per
  theme (see above). No claim is made about the rest of the palette.
- A systematic screen-reader pass (VoiceOver/NVDA) — the tool-based checks
  above (Testing Library's accessible-name/role assertions, axe) are what
  was actually run; nothing here should be read as "tested with a real
  screen reader."

## Phase 9 follow-up: the visual redesign

Phase 9 replaced the app's ad-hoc colors with a design token set (one light
block and one dark block in `apps/web/src/app/globals.css`) and rebuilt every
screen on shared layout primitives. That touched every color on every
screen, so the checks above were re-run rather than assumed to still hold.

**What the redesign added for accessibility:**

- `NavLink` sets `aria-current="page"` on the current section; the visual
  underline is a second signal, not the only one.
- The metric chart's time-range presets expose their pressed state with
  `aria-pressed`, shown visually by a raised surface and heavier weight.
- The chart legend names each overlay by line style (solid series, dashed
  deployment, dotted threshold) as well as by color. Deployment markers
  carry their version as a text label on the canvas.
- `LiveIndicator` shows connection state with text and a dot that changes
  shape (solid, ring, hollow), not just color. It is deliberately not a
  live region itself; the existing throttled region still does the
  announcing.
- Deployment statuses got the same icon and word treatment as alert badges.

**Closing a gap this report named above.** Phase 7 said the wider palette
"was not individually re-measured". Axe's `color-contrast` rule is part of
the WCAG 2 AA tag set the E2E scans already use, so running those scans in
both color schemes now checks text contrast on every scanned screen. The
accessibility spec now runs its four flows once per scheme
(`test.use({ colorScheme })`).

**What was run, and the result:**

| Command | Result |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm test` (root) | pass (web: 9 files, 36 tests; api: 4 files, 11 tests) |
| `pnpm --filter @opslens/api test:integration` (scratch Postgres) | pass (4 files, 9 tests) |
| `pnpm --filter @opslens/web test:e2e` against a production build | pass (11 tests, including 8 axe flows: 4 per color scheme) |
| One-off axe scan (WCAG 2.0/2.1 A and AA tags) of all six routes, light and dark, at 1440px and 390px wide | 24 scans, 0 violations |
| `pnpm build` (root) | pass |

The 390px scans are a one-off check from this phase and are not part of CI.
The same limits as above still apply: no screen-reader session was run, and
nothing here is a conformance claim.
