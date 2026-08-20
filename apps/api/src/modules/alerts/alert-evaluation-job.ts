import type { Alert } from "@opslens/shared-types";
import type { Database } from "../../infra/db/pool";
import { evaluateRule } from "./alert-evaluator";

export type AlertChangeListener = (alert: Alert) => void;

function mapAlertRow(row: Record<string, unknown>): Alert {
  return {
    id: row.id as string,
    alertRuleId: row.alert_rule_id as string,
    serviceId: row.service_id as string,
    environmentId: row.environment_id as string,
    status: row.status as Alert["status"],
    firedAt: new Date(row.fired_at as string).toISOString(),
    acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at as string).toISOString() : null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string).toISOString() : null,
  };
}

/**
 * Evaluates enabled rules per environment. Open firing/acknowledged alerts
 * are never duplicated; a non-violating rule resolves a firing alert
 * (acknowledged alerts retain acknowledgement until manually handled).
 *
 * onAlertChange, when given, is called once per fire/resolve write with the
 * resulting row. This module has no knowledge of SSE or the realtime
 * module — modules/alerts may only depend on infra/, never on
 * modules/realtime directly (apps/api/eslint.config.js's boundary rule) —
 * so the caller (server.ts, the composition root, which isn't itself
 * classified as a "module" and so isn't bound by that rule) is what wires
 * this callback to the event broadcaster.
 */
export async function runAlertEvaluation(db: Database, evaluatedAt = new Date(), onAlertChange?: AlertChangeListener): Promise<number> {
  const rules = await db.query<Record<string, unknown>>("SELECT r.*,m.service_id FROM alert_rules r JOIN metrics m ON m.id=r.metric_id WHERE r.enabled=true ORDER BY r.id ASC"); let changes=0;
  for (const rule of rules.rows) {
    const environments=await db.query<{environment_id:string}>("SELECT DISTINCT environment_id FROM metric_points WHERE metric_id=$1",[rule.metric_id]);
    for(const env of environments.rows) {
      const points=await db.query<{ts:string;value:number}>("SELECT ts,value FROM metric_points WHERE metric_id=$1 AND environment_id=$2 AND ts >= $3 AND ts <= $4 ORDER BY ts ASC,id ASC",[rule.metric_id,env.environment_id,new Date(evaluatedAt.getTime()-Number(rule.duration_seconds)*1000).toISOString(),evaluatedAt.toISOString()]);
      const firing=evaluateRule({comparator:rule.comparator as never,threshold:Number(rule.threshold),durationSeconds:Number(rule.duration_seconds)},points.rows.map(p=>({ts:new Date(p.ts),value:p.value})),evaluatedAt);
      const open=await db.query<{id:string;status:"firing"|"acknowledged"}>("SELECT id,status FROM alerts WHERE alert_rule_id=$1 AND environment_id=$2 AND status IN ('firing','acknowledged') ORDER BY fired_at ASC,id ASC LIMIT 1",[rule.id,env.environment_id]);
      if(firing && !open.rows[0]) {
        try {
          const inserted = await db.query<Record<string, unknown>>("INSERT INTO alerts (alert_rule_id,service_id,environment_id,status,fired_at) VALUES ($1,$2,$3,'firing',$4) RETURNING *",[rule.id,rule.service_id,env.environment_id,evaluatedAt.toISOString()]);
          changes++;
          const row = inserted.rows[0];
          if (row && onAlertChange) onAlertChange(mapAlertRow(row));
        } catch (err) {
          // 23505 = unique_violation on alerts_open_per_rule_environment_idx:
          // another evaluation already opened an alert for this
          // rule/environment between our SELECT and this INSERT. That's the
          // constraint doing its job, not a failure.
          if ((err as { code?: string }).code !== "23505") throw err;
        }
      }
      if(!firing && open.rows[0]?.status === "firing") {
        const updated = await db.query<Record<string, unknown>>("UPDATE alerts SET status='resolved',resolved_at=$1 WHERE id=$2 RETURNING *",[evaluatedAt.toISOString(),open.rows[0].id]);
        changes++;
        const row = updated.rows[0];
        if (row && onAlertChange) onAlertChange(mapAlertRow(row));
      }
    }
  } return changes;
}
