# 11 — Accessibility

Scoped to the first real components this project will build — the fleet
table, alert list, and filters — not an aspirational general a11y policy.
Every requirement below is tied to a specific screen from
[01-product-definition.md](./01-product-definition.md).

## Explicit flag: alert status currently has no color-independent signal

Nothing in the schema or seed data provides a non-color way to distinguish
alert severity or status today — `alertSeveritySchema` is
`info`/`warning`/`critical` and `alertStatusSchema` is
`firing`/`acknowledged`/`resolved`
(`packages/shared-types/src/alert-rule.ts`, `alert.ts`), and nothing about
those enums implies a rendering. Because the natural implementation of "a
critical firing alert" is a red badge, and "a resolved alert" is a green or
gray one, this is flagged explicitly per the task brief: **color must never
be the only signal.** Every alert status/severity rendering needs a paired
non-color cue:

- **Status** (`firing`/`acknowledged`/`resolved`): pair color with an icon
  shape (e.g., filled circle for firing, half-filled for acknowledged, check
  for resolved) *and* the status word itself always rendered as text, never
  hidden behind a tooltip-only icon.
- **Severity** (`info`/`warning`/`critical`): pair color with an icon
  (info/triangle/octagon) and, in the alerts list, an explicit severity
  column with the text label — not just a colored left-border or badge.

## Fleet table (Service list)

- Semantic `<table>` markup with `<th scope="col">` for each column
  (name, active alert count, environments) — not a div-grid styled to look
  like a table. `serviceListItemSchema`'s `activeAlertCount` is the one
  numeric, glanceable signal on this screen and needs a proper
  `<th>`/`<td>` relationship for screen readers to announce "3 active
  alerts" per row correctly, not just "3."
- Sortable column headers (`serviceListQuerySchema`'s `sort`/`order`
  params already support `name`/`createdAt`) must be real buttons inside
  the `<th>`, keyboard-operable (`Enter`/`Space`), with `aria-sort` set on
  the active column.
- A service row with a nonzero `activeAlertCount` needs the same
  color-independent treatment as above — an icon/badge with text, not a
  red-tinted row as the only cue.

## Alert list

- Same semantic-table requirement as the fleet table.
- **Live region for status changes**, required once section 06's real-time
  push lands: when an SSE event transitions an alert's status (e.g.
  `firing` → `resolved`), the change must be announced via an
  `aria-live="polite"` region — polite, not assertive, since a status
  resolving is informational and shouldn't interrupt whatever the user is
  doing. A newly *firing* alert arriving is judgment call between polite and
  assertive; recommend polite for MVP (assertive live regions that fire
  automatically in the background are a well-known source of surprising,
  disorienting screen-reader behavior) and revisit only if user testing
  shows firing alerts are being missed.
- Filter controls (service, environment, status, severity — all four
  `alertListQuerySchema` params) must be real `<select>`/`<label>` pairs or
  an equivalent accessible combobox, keyboard-operable without requiring a
  mouse to open/close, with visible focus states on every interactive
  element (see below).

## Filters (shared across fleet, alerts, deployments screens)

- Every filter control needs a programmatically associated `<label>` (not
  placeholder-as-label), keyboard-reachable in a logical tab order, and
  operable entirely via keyboard (open, navigate options, select, close —
  native `<select>` gets this for free; a custom combobox does not and
  needs its own key handling if one is ever introduced).
- **Visible focus states**: the Next.js default and any component library
  chosen must not ship with `outline: none` and no replacement — every
  focusable element (filter control, table sort header, chart time-range
  control, alert acknowledge button) needs a visible focus indicator that
  meets contrast requirements against its background, in both light and
  dark presentations if the UI supports both.

## Metric chart

Charts are inherently visual; the accessibility requirement here is not
"make the canvas chart itself screen-reader-navigable" (out of scope for
MVP) but ensuring the chart is never the *only* way to get the data:

- The deployment markers overlaid on the chart (section 01, 05) must also
  be reachable as a plain list somewhere on the page (even a visually
  de-emphasized one) — a sighted mouse user can hover a marker for its
  tooltip, but that data point must exist in the accessibility tree too.
- The numeric value driving an alert (the metric's current value vs. the
  rule's threshold) should be stated as text near the chart, not conveyed
  only by where a line sits relative to a threshold line drawn on canvas.

## Deferred, not excluded

Full WCAG audit tooling (axe-core in CI, systematic contrast-ratio
verification across a design system) is reasonable once there are enough
real components to make automated scanning worthwhile — not before. This
section defines the concrete requirements to build correctly from the
start; a systematic audit pass belongs after the components in section 04
exist, not as a prerequisite to building them.
