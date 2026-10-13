import { createAlertRuleSchema, createServiceSchema, type EnvironmentName } from "@opslens/shared-types";
import { ENVIRONMENTS, METRIC_DEFS, SERVICES } from "../simulation/catalog";
import type { Database } from "./pool";

export type ReferenceIds = {
  environmentIds: Map<EnvironmentName, string>;
  serviceIds: Map<string, string>;
  /** key: `${serviceSlug}:${metricName}` */
  metricIds: Map<string, string>;
};

/**
 * Upserts the fleet's reference rows (environments, services, metrics) on
 * their natural unique keys, so running it again never duplicates
 * anything. Shared by seed.ts and bootstrap.ts.
 */
export async function upsertReferenceData(db: Database): Promise<ReferenceIds> {
  const environmentIds = new Map<EnvironmentName, string>();
  for (const name of ENVIRONMENTS) {
    const { rows } = await db.query<{ id: string }>(
      `insert into environments (name) values ($1)
       on conflict (name) do update set name = excluded.name
       returning id`,
      [name],
    );
    const row = rows[0];
    if (!row) throw new Error(`failed to upsert environment ${name}`);
    environmentIds.set(name, row.id);
  }

  const serviceIds = new Map<string, string>();
  for (const service of SERVICES) {
    const input = createServiceSchema.parse({
      name: service.name,
      slug: service.slug,
      description: service.description,
    });
    const { rows } = await db.query<{ id: string }>(
      `insert into services (name, slug, description) values ($1, $2, $3)
       on conflict (slug) do update set
         name = excluded.name, description = excluded.description
       returning id`,
      [input.name, input.slug, input.description],
    );
    const row = rows[0];
    if (!row) throw new Error(`failed to upsert service ${service.slug}`);
    serviceIds.set(service.slug, row.id);
  }

  const metricIds = new Map<string, string>();
  for (const service of SERVICES) {
    const serviceId = serviceIds.get(service.slug);
    if (!serviceId) throw new Error(`missing service id for ${service.slug}`);
    for (const def of METRIC_DEFS) {
      const { rows } = await db.query<{ id: string }>(
        `insert into metrics (service_id, name, unit, kind)
         values ($1, $2, $3, $4)
         on conflict (service_id, name) do update set
           unit = excluded.unit, kind = excluded.kind
         returning id`,
        [serviceId, def.name, def.unit, def.kind],
      );
      const row = rows[0];
      if (!row) throw new Error(`failed to upsert metric ${service.slug}/${def.name}`);
      metricIds.set(`${service.slug}:${def.name}`, row.id);
    }
  }

  return { environmentIds, serviceIds, metricIds };
}

/**
 * Creates the catalogue's alert rule for every metric that has none yet.
 * alert_rules has no natural unique key, so "exists for this metric" is
 * the idempotency check: an existing rule (and the alerts that reference
 * it) is left alone.
 */
export async function ensureAlertRules(db: Database, metricIds: Map<string, string>): Promise<number> {
  let created = 0;
  for (const service of SERVICES) {
    for (const def of METRIC_DEFS) {
      const metricId = metricIds.get(`${service.slug}:${def.name}`);
      if (!metricId) continue;
      const input = createAlertRuleSchema.parse({
        metricId,
        comparator: def.alertComparator,
        threshold: def.alertThreshold,
        durationSeconds: def.alertDurationSeconds,
        severity: def.alertSeverity,
        enabled: true,
      });
      const result = await db.query(
        `insert into alert_rules (metric_id, comparator, threshold, duration_seconds, severity, enabled)
         select $1, $2, $3, $4, $5, $6
         where not exists (select 1 from alert_rules where metric_id = $1)`,
        [input.metricId, input.comparator, input.threshold, input.durationSeconds, input.severity, input.enabled],
      );
      created += result.rowCount ?? 0;
    }
  }
  return created;
}
