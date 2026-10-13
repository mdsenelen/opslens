import type { Database } from "./infra/db/pool";
import { runAlertEvaluation, type AlertChangeListener } from "./modules/alerts/alert-evaluation-job";
import { runSimulationTick, type SimulationTickResult } from "./modules/simulation/simulation-job";

/**
 * One minute of the live demo: write the simulated data up to `now`,
 * replay the evaluator over any incident the process slept through, then
 * evaluate the present.
 *
 * Lives at the composition root, like server.ts, because it joins two
 * modules (simulation and alerts) that the boundary rule keeps from
 * importing each other.
 */
export async function runLiveTick(db: Database, now: Date, onAlertChange?: AlertChangeListener): Promise<SimulationTickResult> {
  const result = await runSimulationTick(db, now);
  for (const instant of result.replayAt) await runAlertEvaluation(db, instant, onAlertChange);
  await runAlertEvaluation(db, now, onAlertChange);
  return result;
}
