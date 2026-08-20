import { buildApp } from "./app";
import { createDatabase } from "./infra/db/pool";
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
const interval = setInterval(() => {
  void runAlertEvaluation(db, new Date(), (alert) => eventBroadcaster.publish({ type: "alert-status", alert }))
    .catch((err) => app.log.error(err, "alert evaluation failed"));
}, 60_000);
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
