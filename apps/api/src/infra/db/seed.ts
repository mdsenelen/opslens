import {
  createAlertRuleSchema,
  createDeploymentSchema,
  createServiceSchema,
  type AlertComparator,
  type AlertSeverity,
  type EnvironmentName,
  type MetricKind,
} from "@opslens/shared-types";
import { Pool } from "pg";

/**
 * Deterministic seed for local dev / demo. Reference data (services,
 * environments, metrics) is upserted on its natural unique key so re-running
 * this script never duplicates it. The generated time-series tables
 * (metric_points, alert_rules, alerts, deployments) have no natural key that
 * makes sense to upsert on — they're wholly owned by this script — so those
 * are cleared and regenerated fresh each run. See the blueprint's "seed data
 * strategy": one injected anomaly, with a deployment just before it and an
 * alert produced by it, so the "investigate a regression" journey always has
 * a real answer to find.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://opslens:opslens@localhost:5432/opslens";

const SEED = 42;

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (Math.imul(hash, 31) + label.charCodeAt(i)) | 0;
  }
  return hash ^ SEED;
}

type ServiceSeed = { slug: string; name: string; description: string };

const SERVICES: ServiceSeed[] = [
  {
    slug: "checkout-api",
    name: "Checkout API",
    description: "Handles cart checkout and order creation.",
  },
  {
    slug: "payments-api",
    name: "Payments API",
    description: "Processes payment authorization and capture.",
  },
  {
    slug: "inventory-api",
    name: "Inventory API",
    description: "Tracks stock levels across warehouses.",
  },
  {
    slug: "notifications-worker",
    name: "Notifications Worker",
    description: "Sends order and shipping notification emails.",
  },
];

const ENVIRONMENTS: EnvironmentName[] = [
  "production",
  "staging",
  "development",
];

type MetricDef = {
  name: string;
  unit: string;
  kind: MetricKind;
  baseline: number;
  noise: number;
  floor: number;
  alertComparator: AlertComparator;
  alertThreshold: number;
  alertDurationSeconds: number;
  alertSeverity: AlertSeverity;
};

const METRIC_DEFS: MetricDef[] = [
  {
    name: "p95_latency_ms",
    unit: "ms",
    kind: "gauge",
    baseline: 120,
    noise: 8,
    floor: 15,
    alertComparator: "gt",
    alertThreshold: 300,
    alertDurationSeconds: 300,
    alertSeverity: "warning",
  },
  {
    name: "error_rate_pct",
    unit: "percent",
    kind: "gauge",
    baseline: 0.4,
    noise: 0.15,
    floor: 0,
    alertComparator: "gt",
    alertThreshold: 5,
    alertDurationSeconds: 180,
    alertSeverity: "critical",
  },
];

// Environments that get generated traffic, and at what resolution — mirrors
// real fleets where staging sees lower, sparser volume than production, and
// development gets none.
const DATA_ENVIRONMENTS: {
  name: EnvironmentName;
  windowHours: number;
  stepMinutes: number;
}[] = [
  { name: "production", windowHours: 24, stepMinutes: 1 },
  { name: "staging", windowHours: 24, stepMinutes: 5 },
];

// The one injected regression: payments-api's p95 latency and error rate
// both spike for 15 minutes, ~6h ago, a few minutes after a deploy.
const ANOMALY = {
  serviceSlug: "payments-api",
  environment: "production" as EnvironmentName,
  startHoursAgo: 6,
  durationMinutes: 15,
  latencyMultiplier: 3.5,
  errorRatePct: 9,
  deployment: {
    version: "v2.14.0",
    minutesBeforeAnomaly: 4,
  },
};

function clamp(value: number, floor: number): number {
  return Math.max(floor, value);
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const now = Date.now();

  try {
    console.log(`Seeding against ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);

    // --- reference data: upsert by natural key -----------------------------
    const environmentIds = new Map<EnvironmentName, string>();
    for (const name of ENVIRONMENTS) {
      const { rows } = await pool.query<{ id: string }>(
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
      const { rows } = await pool.query<{ id: string }>(
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

    const metricIds = new Map<string, string>(); // key: `${slug}:${metricName}`
    for (const service of SERVICES) {
      const serviceId = serviceIds.get(service.slug);
      if (!serviceId) throw new Error(`missing service id for ${service.slug}`);
      for (const def of METRIC_DEFS) {
        const { rows } = await pool.query<{ id: string }>(
          `insert into metrics (service_id, name, unit, kind)
           values ($1, $2, $3, $4)
           on conflict (service_id, name) do update set
             unit = excluded.unit, kind = excluded.kind
           returning id`,
          [serviceId, def.name, def.unit, def.kind],
        );
        const row = rows[0];
        if (!row) {
          throw new Error(`failed to upsert metric ${service.slug}/${def.name}`);
        }
        metricIds.set(`${service.slug}:${def.name}`, row.id);
      }
    }

    // --- generated data: clear and regenerate, dependency order first -----
    await pool.query("delete from alerts");
    await pool.query("delete from alert_rules");
    await pool.query("delete from metric_points");
    await pool.query("delete from deployments");

    // --- alert rules --------------------------------------------------
    const alertRuleIds = new Map<string, string>(); // key: `${slug}:${metricName}`
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
        const { rows } = await pool.query<{ id: string }>(
          `insert into alert_rules
             (metric_id, comparator, threshold, duration_seconds, severity, enabled)
           values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [
            input.metricId,
            input.comparator,
            input.threshold,
            input.durationSeconds,
            input.severity,
            input.enabled,
          ],
        );
        const row = rows[0];
        if (!row) {
          throw new Error(`failed to insert alert rule for ${service.slug}/${def.name}`);
        }
        alertRuleIds.set(`${service.slug}:${def.name}`, row.id);
      }
    }

    // --- metric points: random walk per (service, metric, environment) ----
    const metricIdArr: string[] = [];
    const environmentIdArr: string[] = [];
    const tsArr: string[] = [];
    const valueArr: number[] = [];

    for (const service of SERVICES) {
      for (const def of METRIC_DEFS) {
        const metricId = metricIds.get(`${service.slug}:${def.name}`);
        if (!metricId) continue;

        for (const envConfig of DATA_ENVIRONMENTS) {
          const environmentId = environmentIds.get(envConfig.name);
          if (!environmentId) continue;

          const rng = mulberry32(
            hashSeed(`${service.slug}:${def.name}:${envConfig.name}`),
          );
          const stepMs = envConfig.stepMinutes * 60 * 1000;
          const pointCount = Math.floor(
            (envConfig.windowHours * 60) / envConfig.stepMinutes,
          );

          const isAnomalyService =
            service.slug === ANOMALY.serviceSlug &&
            envConfig.name === ANOMALY.environment;
          const anomalyStart = now - ANOMALY.startHoursAgo * 60 * 60 * 1000;
          const anomalyEnd = anomalyStart + ANOMALY.durationMinutes * 60 * 1000;

          let value = def.baseline;
          for (let i = pointCount; i >= 0; i--) {
            const ts = now - i * stepMs;
            value = clamp(value + (rng() - 0.5) * 2 * def.noise, def.floor);

            let emittedValue = value;
            if (isAnomalyService && ts >= anomalyStart && ts <= anomalyEnd) {
              emittedValue =
                def.name === "error_rate_pct"
                  ? ANOMALY.errorRatePct + (rng() - 0.5) * def.noise
                  : value * ANOMALY.latencyMultiplier;
            }

            metricIdArr.push(metricId);
            environmentIdArr.push(environmentId);
            tsArr.push(new Date(ts).toISOString());
            valueArr.push(Number(emittedValue.toFixed(3)));
          }
        }
      }
    }

    await pool.query(
      `insert into metric_points (metric_id, environment_id, ts, value)
       select * from unnest($1::uuid[], $2::uuid[], $3::timestamptz[], $4::double precision[])`,
      [metricIdArr, environmentIdArr, tsArr, valueArr],
    );

    // --- deployments: the one that precedes the anomaly, plus a few more --
    const deploymentRows: {
      serviceSlug: string;
      environment: EnvironmentName;
      version: string;
      status: "pending" | "success" | "failed";
      deployedAt: string;
    }[] = [
      {
        serviceSlug: ANOMALY.serviceSlug,
        environment: ANOMALY.environment,
        version: ANOMALY.deployment.version,
        status: "success",
        deployedAt: new Date(
          now -
            ANOMALY.startHoursAgo * 60 * 60 * 1000 -
            ANOMALY.deployment.minutesBeforeAnomaly * 60 * 1000,
        ).toISOString(),
      },
      {
        serviceSlug: "checkout-api",
        environment: "production",
        version: "v3.2.1",
        status: "success",
        deployedAt: new Date(now - 10 * 60 * 60 * 1000).toISOString(),
      },
      {
        serviceSlug: "checkout-api",
        environment: "staging",
        version: "v3.3.0-rc1",
        status: "failed",
        deployedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      },
      {
        serviceSlug: "inventory-api",
        environment: "production",
        version: "v1.9.4",
        status: "success",
        deployedAt: new Date(now - 20 * 60 * 60 * 1000).toISOString(),
      },
      {
        serviceSlug: "notifications-worker",
        environment: "production",
        version: "v0.11.2",
        status: "success",
        deployedAt: new Date(now - 15 * 60 * 60 * 1000).toISOString(),
      },
    ];

    for (const deployment of deploymentRows) {
      const serviceId = serviceIds.get(deployment.serviceSlug);
      const environmentId = environmentIds.get(deployment.environment);
      if (!serviceId || !environmentId) continue;
      const input = createDeploymentSchema.parse({
        serviceId,
        environmentId,
        version: deployment.version,
        status: deployment.status,
        deployedAt: deployment.deployedAt,
      });
      await pool.query(
        `insert into deployments (service_id, environment_id, version, status, deployed_at)
         values ($1, $2, $3, $4, $5)`,
        [
          input.serviceId,
          input.environmentId,
          input.version,
          input.status,
          input.deployedAt,
        ],
      );
    }

    // --- alerts: one firing (the anomaly), one already resolved -----------
    const anomalyAlertRuleId = alertRuleIds.get(
      `${ANOMALY.serviceSlug}:error_rate_pct`,
    );
    const anomalyServiceId = serviceIds.get(ANOMALY.serviceSlug);
    const anomalyEnvironmentId = environmentIds.get(ANOMALY.environment);
    if (anomalyAlertRuleId && anomalyServiceId && anomalyEnvironmentId) {
      const firedAt = new Date(
        now -
          ANOMALY.startHoursAgo * 60 * 60 * 1000 +
          METRIC_DEFS[1]!.alertDurationSeconds * 1000,
      ).toISOString();
      await pool.query(
        `insert into alerts
           (alert_rule_id, service_id, environment_id, status, fired_at)
         values ($1, $2, $3, 'firing', $4)`,
        [anomalyAlertRuleId, anomalyServiceId, anomalyEnvironmentId, firedAt],
      );
    }

    const resolvedAlertRuleId = alertRuleIds.get("inventory-api:error_rate_pct");
    const resolvedServiceId = serviceIds.get("inventory-api");
    const resolvedEnvironmentId = environmentIds.get("production");
    if (resolvedAlertRuleId && resolvedServiceId && resolvedEnvironmentId) {
      const firedAt = new Date(now - 20 * 60 * 60 * 1000).toISOString();
      const acknowledgedAt = new Date(
        now - 19.83 * 60 * 60 * 1000,
      ).toISOString();
      const resolvedAt = new Date(now - 19.5 * 60 * 60 * 1000).toISOString();
      await pool.query(
        `insert into alerts
           (alert_rule_id, service_id, environment_id, status, fired_at, acknowledged_at, resolved_at)
         values ($1, $2, $3, 'resolved', $4, $5, $6)`,
        [
          resolvedAlertRuleId,
          resolvedServiceId,
          resolvedEnvironmentId,
          firedAt,
          acknowledgedAt,
          resolvedAt,
        ],
      );
    }

    console.log(
      `Seeded ${SERVICES.length} services, ${ENVIRONMENTS.length} environments, ` +
        `${metricIds.size} metrics, ${valueArr.length} metric points, ` +
        `${deploymentRows.length} deployments, ${alertRuleIds.size} alert rules, 2 alerts.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
