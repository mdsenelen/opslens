# 06 — Real-time architecture

## What needs to be real-time

Two kinds of server-originated updates to an already-open dashboard: new
`MetricPoint` rows as they're written, and `Alert` status transitions
(`firing` → `resolved`, or a new alert created) as
`alert-evaluation-job.ts` produces them once per minute
(`server.ts:18-20`). Nothing in this project needs the client to push
anything back over the same channel — every write path that exists (there
are none yet; see [01-product-definition.md](./01-product-definition.md)'s
explicit exclusion of mutation UI) would be an ordinary REST call, not a
message on a real-time channel.

## Transport decision: Server-Sent Events

**Recommendation: SSE**, via a native `EventSource` on the client and a
single streaming Fastify route on the server. Weighed explicitly against
the two alternatives for this project's actual scale and shape:

**vs. polling.** Polling (the client re-fetching `GET /metrics/:id/points`
on an interval) is the simplest possible option and was seriously
considered — it needs zero new server infrastructure. Rejected because it
either wastes requests (polling faster than the 60-second evaluation
cadence buys nothing) or under-responds to it (polling slower than 60s
means a status change can sit un-shown for up to a full cycle) — an
event-driven push naturally aligns the client's update with the moment the
evaluator actually writes new state, and one persistent connection per
open dashboard is cheaper than N repeated full-payload GETs against a
single-instance API server.

**vs. WebSockets.** This is the comparison the task brief specifically asks
to justify, and the answer is genuinely "SSE is the better fit here, not
just the simpler one":

- The data flow is one-directional (server → client). WebSockets' value is
  bidirectional messaging over one connection — this project has nothing to
  send client → server over a real-time channel, so a WS connection would
  be used exactly like an SSE connection while carrying protocol machinery
  (framing, ping/pong keepalive, an upgrade handshake) this app never
  exercises.
- `EventSource` reconnects automatically on drop with no application code —
  the browser retries the connection itself (with a server-settable retry
  delay via the `retry:` field). A WS server needs that logic hand-written
  and tested, for a capability this project needs anyway (see reconnection
  section below) and would rather get for free.
- No horizontal-scaling / connection-affinity problem exists to justify
  WS's typically-paired infrastructure (a pub/sub broker like Redis to fan
  out events across instances) — `server.ts` runs one process with one
  in-memory `setInterval` evaluator and explicitly "has no distributed
  coordination" (`server.ts:16-17`). Introducing WebSockets here would
  invite exactly the kind of "solve it for scale we don't have" addition
  [00-overview.md](./00-overview.md) rules out (no Redis/message queue).
- SSE rides plain HTTP/1.1 through the same Fastify instance, the same CORS
  config already in `app.ts:23-25`, and the same infrastructure (reverse
  proxies, load balancers) that already has to support the existing REST
  routes — no new protocol to provision for.

WebSockets would be the right call if this app needed the client to send
real-time signals back (e.g. collaborative cursors, live chat) or needed to
push binary data at high frequency — neither applies.

## Server-side design

New module `apps/api/src/modules/realtime/` (the module
`eslint.config.js`'s comment already names but doesn't yet contain — see
[07-backend-architecture.md](./07-backend-architecture.md) and
[12-repo-structure.md](./12-repo-structure.md)):

- **`realtime.routes.ts`** — one route, `GET /api/realtime/stream`, sets
  `Content-Type: text/event-stream`, keeps the connection open, and writes
  `event: metric-point` / `event: alert-status` payloads as they occur.
  Query-parameterized by the same scope the client is currently viewing
  (`serviceId`, `environment`) so a client only receives events relevant to
  its open screen, not a full-fleet firehose it has to filter client-side.
- **`event-broadcaster.ts`** — an in-process event emitter (Node's
  `EventEmitter`, nothing external) that the evaluation job publishes to
  after each tick, and that each open SSE connection subscribes to for the
  duration of the request. This is the entire "pub/sub" this project needs
  — in-process, because there's one process; introducing Redis pub/sub here
  would be solving the multi-instance fan-out problem this app doesn't
  have, which `server.ts`'s own comment already disclaims.
- `alert-evaluation-job.ts`'s `runAlertEvaluation` gains one additional
  responsibility: after writing an alert insert/update, publish the change
  to the broadcaster — a few lines added at the two existing write sites
  (`alert-evaluation-job.ts:13` and `:14`), not a restructuring of the job.
  New metric points don't currently have a write path in this API (they're
  seed-only today, per [01-product-definition.md](./01-product-definition.md)'s
  exclusion of mutation UI) — the `metric-point` event type is specified
  now so the contract exists, but has no producer until a points-ingestion
  endpoint exists; documented here as a known gap, not silently ignored.

## Client-side design

`lib/realtime-client.ts` wraps `EventSource` with:

- **Connection lifecycle**: open on mount of any view that needs live
  updates (the Metric chart, the Alerts list/detail — not the Fleet
  Overview or Deployments list, which have no real-time requirement per
  section 01), close on unmount. Scoped per the same `serviceId`/
  `environment` the view is already showing, matching the server-side
  scoping above.
- **Reconnection/backoff**: `EventSource`'s built-in retry handles the
  common case (a momentary network blip) with no application code. For
  the case where reconnection itself keeps failing (the API process is
  down, not just a network hiccup), the client should track consecutive
  failures and surface the "real-time connection lost" state from
  [02-user-journeys.md](./02-user-journeys.md)'s state table rather than
  retrying silently forever with no user-visible signal — a simple counter
  in the wrapper, not a custom exponential-backoff reimplementation (the
  browser already backs off `EventSource` retries reasonably).
- **Stale-data handling**: on reconnect after a drop, the client cannot
  assume it received every event that occurred while disconnected (SSE has
  no built-in gap-filling beyond the `Last-Event-ID` mechanism, which this
  MVP does not implement — see below). On reconnect, the client re-runs its
  normal initial fetch (the same server-state fetch from
  [04-frontend-architecture.md](./04-frontend-architecture.md)) to
  resynchronize, then resumes applying live events from that fresh
  baseline — simpler and more robust than trying to replay missed events,
  and correct because every view's initial state is already a full,
  authoritative snapshot from the REST API.
- **Duplicate-event handling**: an `alert-status` event for a status the
  client already has recorded (e.g. a reconnect-triggered refetch and a
  live event both report the same transition) is a no-op apply, not an
  error — the client patches state to the event's payload idempotently
  (set status to the received value) rather than treating events as deltas
  that must apply exactly once.
- **Ordering**: `EventSource` delivers events over one HTTP connection in
  the order the server wrote them, so within a single connection's
  lifetime no client-side reordering logic is needed. Across a
  disconnect/reconnect boundary, ordering is not guaranteed relative to
  events missed during the gap — handled by the resync-on-reconnect
  behavior above rather than by sequence numbers, which this MVP does not
  need given the resync approach already produces a correct end state.
- **Failure handling**: if the initial `EventSource` connection itself
  fails to establish (not a drop-after-connecting, but never connecting at
  all — e.g. `realtime.routes.ts` returning an error), the view still
  renders its initial REST-fetched data and shows the same "real-time
  connection lost" indicator — never a hard failure of the whole screen,
  consistent with `README.md:40`'s "no screen should hard-crash" principle
  already established for the base REST fetch.

## Explicit dependency on the evaluator fix

This architecture is only demonstrably useful once
[07-backend-architecture.md](./07-backend-architecture.md)'s
recency-tolerance fix to `alert-evaluator.ts` ships — today, the evaluator's
exact-instant condition means `runAlertEvaluation` practically never
transitions an alert's status against realistic ingestion cadence, so an
SSE stream of alert-status events would have nothing real to broadcast
during a demo. Noted in [00-overview.md](./00-overview.md) as a soft
dependency between sections, not a contradiction — building the SSE
transport itself has no dependency on the fix, but proving it end-to-end
against the seeded regression scenario does.
