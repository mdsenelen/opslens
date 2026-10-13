import type { Alert } from "@opslens/shared-types";
import { buildApp } from "./app";
import { createDatabase } from "./infra/db/pool";
import { runLiveTick } from "./live-simulation";
import { runAlertEvaluation } from "./modules/alerts/alert-evaluation-job";
import { eventBroadcaster } from "./modules/realtime/event-broadcaster";

const db = createDatabase();
const app = buildApp({ db });
const port = Number(process.env.PORT ?? 4000);

app
  .listen({ port, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

// One-process, best-effort evaluator. It deliberately has no distributed
// coordination; production multi-instance scheduling is outside Phase 2.
// The onAlertChange callback is the only link between the alerts module and
// the realtime module — wired here, not by alert-evaluation-job.ts
// importing modules/realtime directly, which the module boundary rule in
// apps/api/eslint.config.js forbids.
//
// With SIMULATION_ENABLED=true (the hosted demo) each tick first writes the
// simulated data up to now (live-simulation.ts), and the first tick runs at
// boot so a process that just woke up fills in what it missed before anyone
// reads it. Without it, nothing writes data and only the evaluator runs,
// exactly as before: local development and the E2E suite keep the seed's
// fixed scenario.
const simulationEnabled = process.env.SIMULATION_ENABLED === "true";
const publishAlert = (alert: Alert) => eventBroadcaster.publish({ type: "alert-status", alert });
let tickRunning = false;

async function tick(): Promise<void> {
  // A slow tick (the first backfill, a cold database) must not overlap the next.
  if (tickRunning) return;
  tickRunning = true;
  try {
    const now = new Date();
    if (simulationEnabled) {
      const result = await runLiveTick(db, now, publishAlert);
      if (result.pointsWritten > 60 || result.replayAt.length > 0) {
        app.log.info({ pointsWritten: result.pointsWritten, deploymentsWritten: result.deploymentsWritten, replayed: result.replayAt.length }, "simulation caught up");
      }
    } else {
      await runAlertEvaluation(db, now, publishAlert);
    }
  } catch (err) {
    app.log.error(err, simulationEnabled ? "simulation tick failed" : "alert evaluation failed");
  } finally {
    tickRunning = false;
  }
}

if (simulationEnabled) void tick();
const interval = setInterval(() => void tick(), 60_000);
interval.unref();

app.addHook("onClose", async () => db.end());

// Graceful shutdown: stop the evaluator and drain in-flight requests before
// the process exits, rather than being killed mid-query by an orchestrator's
// stop signal.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    clearInterval(interval);
    void app.close().then(
      () => process.exit(0),
      (err) => {
        app.log.error(err, "error during graceful shutdown");
        process.exit(1);
      },
    );
  });
}
