import { createDatabase } from "./pool";
import { ensureAlertRules, upsertReferenceData } from "./reference-data";

/**
 * Prepares a database for the live demo: the fleet's services,
 * environments, metrics and alert rules, and nothing else. Unlike seed.ts
 * it never deletes anything, so the hosted API runs it on every start;
 * the simulation (SIMULATION_ENABLED=true) then writes the data.
 */
async function main() {
  const db = createDatabase();
  try {
    const { serviceIds, metricIds } = await upsertReferenceData(db);
    const rulesCreated = await ensureAlertRules(db, metricIds);
    console.log(`Bootstrap: ${serviceIds.size} services, ${metricIds.size} metrics, ${rulesCreated} new alert rules.`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
