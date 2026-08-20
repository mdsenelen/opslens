# 09 — Testing

## Baseline: three files, three layers, already good

- `apps/api/src/modules/alerts/alert-evaluator.test.ts` — pure unit tests
  against `evaluateRule`, no database.
- `apps/api/src/modules/api-contracts.test.ts` — Zod schema/contract tests,
  confirming the shared query schemas reject unsafe input (SQL-injection
  shaped strings, oversized limits) before any handler runs.
- `apps/api/src/api-validation.test.ts` — HTTP-level tests via
  `app.inject(...)` against a fake `db` that throws if queried
  (`api-validation.test.ts:6-12`), proving invalid requests are rejected by
  Zod validation *before* touching the database.

This is a genuinely good foundation with one honest gap: **nothing here
touches a real Postgres instance.** Every route's actual SQL — the `WHERE`
clause assembly, the joins, the pagination math, the two live bugs the
audit found — is exercised by none of the three files, since the
fake-DB tests deliberately never reach a query, and the pure evaluator
tests never reach the job that calls it against real rows. This is the
correct place to extend from, per the audit's own prioritization.

## Priority 1: integration tests against real Postgres

`docker-compose.yml` already provisions a real Postgres 16 for local dev
(`pnpm db:up`). The highest-leverage addition is a test suite that runs
migrations, seeds (or inserts fixture rows) against that real instance, and
exercises each route's actual SQL — this is the only layer that can catch
the two live bugs the audit named, since both are SQL/data-shape bugs, not
validation-schema bugs:

- **The 404-vs-empty bug**: a test that inserts a metric with points in
  `production` but none in `staging`, then asserts
  `GET /metrics/:id/points?environment=staging` returns `200` with
  `points: []` — this test should be written to the *fixed* behavior
  first (per [07-backend-architecture.md](./07-backend-architecture.md)),
  so it fails against current code and passes once the fix lands, giving
  the fix a regression guard.
- **The evaluator recency-tolerance bug**: an integration test (distinct
  from the existing pure-unit test) that inserts real metric points at a
  realistic cadence (e.g. one per minute, matching the seed's production
  step) ending a few seconds before `evaluatedAt`, runs
  `runAlertEvaluation`, and asserts an alert is actually created — this is
  the test that would have caught the bug the pure `evaluateRule` tests
  didn't, because the pure tests construct point timestamps by hand
  (`alert-evaluator.test.ts`'s `point(secondsAgo, value)` helper) and can
  accidentally encode the same wrong assumption the implementation makes.
- **The alert-dedup constraint** (once added per
  [08-database.md](./08-database.md)): a test that runs
  `runAlertEvaluation` twice in a row against the same violating data and
  asserts exactly one open alert exists, not two — this is exactly the
  idempotency claim `README.md:26` already makes ("repeated evaluations are
  idempotent"); an integration test is what actually proves it against a
  real unique-constraint-backed table rather than trusting the
  application-only check.
- One test per route file confirming the actual pagination math
  (`page`/`limit`/`total`) and filter predicates against inserted fixture
  rows — this is where the shared `paginate()` helper from
  [07-backend-architecture.md](./07-backend-architecture.md) gets its real
  correctness proof, across all four modules that use it.

Mechanically: a `vitest` config variant (or a separate `test:integration`
script) that runs against `DATABASE_URL` pointed at the docker-compose
instance, with a `beforeEach` that truncates and re-inserts fixture rows
(cheaper and more explicit per-test than re-running the full seed script) —
gated in CI behind `pnpm db:up` running first (see the CI note below).

## Priority 2: remaining evaluator edge cases

Beyond the recency-tolerance case above, the pure `evaluateRule` function
has a few more cases worth locking down given how central it is to the demo
narrative:

- Duration boundary exactness: a window whose earliest point is
  *exactly* at `evaluatedAt - durationSeconds` (currently required by
  `alert-evaluator.ts:17`'s `window[0]!.ts.getTime() <= start` — should
  remain a strict boundary, tested explicitly rather than only covered
  incidentally).
- A rule that stops violating partway through the window (already partially
  covered by the existing "non-violating point" test in
  `alert-evaluator.test.ts:18`, but only for a value dip, not for a
  comparator-boundary-exact value — e.g. a point exactly equal to
  `threshold` under `gt` vs `gte`).
- Resolution transition: a rule that *was* firing and its latest window no
  longer violates — this is `alert-evaluation-job.ts:14`'s resolve path,
  currently only exercised implicitly by the seed data's "one already
  resolved" alert, never by a test that runs the job through a fire→resolve
  transition directly.

## Priority 3: component tests (React Testing Library) — once real UI exists

Explicitly sequenced after the frontend components in
[04-frontend-architecture.md](./04-frontend-architecture.md) exist — there
is nothing to component-test yet. Priority order once they do, matching
this spec's stated MVP risk: the four-way `ApiError` state rendering
(loading/empty/error/retry per screen, section 02) first, since that's the
behavior most likely to silently regress; then filter-to-URL-state wiring;
then the alert-status live region from
[11-accessibility.md](./11-accessibility.md), since a11y regressions in
live-updating content are easy to introduce silently.

## Priority 4: Playwright E2E — last, and scoped to one or two flows

Not before there's a real UI to test end-to-end. When it lands, scope it to
exactly the journeys that justify the tooling overhead — the primary
regression-investigation journey from
[02-user-journeys.md](./02-user-journeys.md) (dashboard → service →
metric chart → deployment correlation → alert detail) as one flow, and the
real-time reconnection behavior from
[06-realtime-architecture.md](./06-realtime-architecture.md) as a second
(simulate the SSE connection dropping and confirm the UI reflects
"reconnecting" then recovers). Not a broad E2E suite covering every screen
— that duplicates what component tests already cover at far higher cost
per test.

## CI

No CI exists today though `pnpm -r {lint,typecheck,test,build}` already
work per-workspace. A CI workflow should run, per commit: `lint`,
`typecheck`, and `test` (which by default should mean the fast, DB-less
tests — evaluator unit tests, contract tests, HTTP-validation tests) on
every push, with the Postgres-backed integration suite from Priority 1
gated behind a docker-compose Postgres service in the CI job (GitHub
Actions' `services:` block, matching `docker-compose.yml`'s image/
credentials) so it runs on every push too, not just locally. This is
infrastructure work, not a testing-strategy decision — flagged here as a
concrete next step, not designed further in this document.
