import type { EnvironmentName } from "@opslens/shared-types";
import { SERVICES, type MetricDef } from "./catalog";

/**
 * The live demo's script, as pure functions of wall-clock time.
 *
 * Every value, deployment and incident is computed from the timestamp
 * alone, never from what was written before. That is what lets the
 * simulation job fill in any stretch of time it missed (the free hosting
 * tier puts the API to sleep when nobody is using it) and produce exactly
 * the data it would have written had it been awake.
 *
 * The schedule, in UTC:
 * - Every 3 hours (00:00, 03:00, ...) a period starts. Period k belongs to
 *   service k mod 4, so each service has an incident every 12 hours.
 * - At :40 into the period that service ships a new release to production
 *   (it reached staging an hour earlier, where it looked fine).
 * - 4 minutes later its error rate and p95 latency spike.
 * - 13 minutes after the spike starts, on-call rolls back to the previous
 *   release, and 2 minutes later the metrics recover.
 * - At 1:50 into the period a different service ships a healthy release,
 *   so not every deployment on a chart is guilty.
 *
 * The alert rules are not consulted here. Alerts are opened and resolved
 * by the real evaluator reading the points this produces.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const PERIOD_MS = 3 * HOUR;
export const RELEASE_OFFSET_MS = 40 * MINUTE;
export const HEALTHY_RELEASE_OFFSET_MS = 110 * MINUTE;
export const STAGING_LEAD_MS = HOUR;
export const SPIKE_DELAY_MS = 4 * MINUTE;
export const ROLLBACK_AFTER_SPIKE_MS = 13 * MINUTE;
export const RECOVERY_AFTER_ROLLBACK_MS = 2 * MINUTE;

const INCIDENT_ENVIRONMENT: EnvironmentName = "production";
const LATENCY_MULTIPLIER = 3.5;
// One major version per service, so versions read differently per service.
const MAJOR_VERSIONS = [3, 2, 1, 0];

export type Incident = {
  period: number;
  serviceSlug: string;
  environment: EnvironmentName;
  releasedAt: number;
  spikeStart: number;
  rolledBackAt: number;
  spikeEnd: number;
  peakErrorRatePct: number;
};

export type ScheduledDeployment = {
  serviceSlug: string;
  environment: EnvironmentName;
  version: string;
  deployedAt: number;
  kind: "release" | "rollback";
};

/** Deterministic uniform value in [0, 1) for a label. */
export function hash01(label: string): number {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // A final avalanche so neighbouring labels (minute n, minute n+1) do not
  // produce visibly correlated values.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function periodOf(t: number): number {
  return Math.floor(t / PERIOD_MS);
}

function incidentServiceIndex(period: number): number {
  return ((period % SERVICES.length) + SERVICES.length) % SERVICES.length;
}

function healthyServiceIndex(period: number): number {
  return incidentServiceIndex(period + 2);
}

/**
 * A service releases in every other period (its incident release in one,
 * its healthy release two periods later), so floor(period / 2) counts that
 * service's releases and only ever goes up.
 */
function versionFor(serviceIdx: number, period: number): string {
  const n = Math.floor(period / 2);
  return `v${MAJOR_VERSIONS[serviceIdx] ?? 1}.${Math.floor(n / 10) % 100}.${n % 10}`;
}

export function incidentForPeriod(period: number): Incident {
  const service = SERVICES[incidentServiceIndex(period)]!;
  const releasedAt = period * PERIOD_MS + RELEASE_OFFSET_MS;
  const spikeStart = releasedAt + SPIKE_DELAY_MS;
  const rolledBackAt = spikeStart + ROLLBACK_AFTER_SPIKE_MS;
  return {
    period,
    serviceSlug: service.slug,
    environment: INCIDENT_ENVIRONMENT,
    releasedAt,
    spikeStart,
    rolledBackAt,
    spikeEnd: rolledBackAt + RECOVERY_AFTER_ROLLBACK_MS,
    // Between 7% and 12%: always clearly above the 5% rule, never identical.
    peakErrorRatePct: 7 + 5 * hash01(`incident:${period}`),
  };
}

/** Incidents whose release-to-recovery span overlaps [from, to]. */
export function incidentsBetween(from: number, to: number): Incident[] {
  const incidents: Incident[] = [];
  for (let period = periodOf(from) - 1; period <= periodOf(to); period++) {
    const incident = incidentForPeriod(period);
    if (incident.spikeEnd >= from && incident.releasedAt <= to) incidents.push(incident);
  }
  return incidents;
}

function deploymentsForPeriod(period: number): ScheduledDeployment[] {
  const incidentIdx = incidentServiceIndex(period);
  const healthyIdx = healthyServiceIndex(period);
  const incident = incidentForPeriod(period);
  const badVersion = versionFor(incidentIdx, period);
  // The release this service shipped before the bad one: its healthy
  // release two periods earlier.
  const previousVersion = versionFor(incidentIdx, period - 2);
  const healthyVersion = versionFor(healthyIdx, period);
  const healthyAt = period * PERIOD_MS + HEALTHY_RELEASE_OFFSET_MS;
  const incidentSlug = SERVICES[incidentIdx]!.slug;
  const healthySlug = SERVICES[healthyIdx]!.slug;
  return [
    { serviceSlug: incidentSlug, environment: "staging", version: badVersion, deployedAt: incident.releasedAt - STAGING_LEAD_MS, kind: "release" },
    { serviceSlug: incidentSlug, environment: "production", version: badVersion, deployedAt: incident.releasedAt, kind: "release" },
    { serviceSlug: incidentSlug, environment: "production", version: previousVersion, deployedAt: incident.rolledBackAt, kind: "rollback" },
    { serviceSlug: healthySlug, environment: "staging", version: healthyVersion, deployedAt: healthyAt - STAGING_LEAD_MS, kind: "release" },
    { serviceSlug: healthySlug, environment: "production", version: healthyVersion, deployedAt: healthyAt, kind: "release" },
  ];
}

/** Every scheduled deployment with from < deployedAt <= to. */
export function deploymentsBetween(from: number, to: number): ScheduledDeployment[] {
  const deployments: ScheduledDeployment[] = [];
  for (let period = periodOf(from) - 1; period <= periodOf(to) + 1; period++) {
    for (const d of deploymentsForPeriod(period)) {
      if (d.deployedAt > from && d.deployedAt <= to) deployments.push(d);
    }
  }
  return deployments.sort((a, b) => a.deployedAt - b.deployedAt);
}

/**
 * A metric's value at time t. Normal traffic is the catalogue baseline,
 * swinging 10% over a day (busier in the afternoon) with per-minute
 * noise. During an incident on this service and environment the error
 * rate jumps to the incident's peak and p95 latency to 3.5 times normal.
 */
export function valueAt(serviceSlug: string, metric: MetricDef, environment: EnvironmentName, t: number): number {
  const series = `${serviceSlug}:${metric.name}:${environment}`;
  const phase = 2 * Math.PI * hash01(`phase:${serviceSlug}`);
  const daily = 1 + 0.1 * Math.sin((2 * Math.PI * (t % DAY)) / DAY + phase);
  const noise = (hash01(`${series}:${Math.floor(t / MINUTE)}`) - 0.5) * 2 * metric.noise;
  let value = Math.max(metric.floor, metric.baseline * daily + noise);

  if (environment === INCIDENT_ENVIRONMENT) {
    const incident = incidentForPeriod(periodOf(t));
    if (incident.serviceSlug === serviceSlug && t >= incident.spikeStart && t < incident.spikeEnd) {
      value = metric.name === "error_rate_pct" ? incident.peakErrorRatePct + noise : value * LATENCY_MULTIPLIER;
    }
  }
  return Number(value.toFixed(3));
}

/** Step-aligned timestamps with after < ts <= until. */
export function timestampsBetween(after: number, until: number, stepMs: number): number[] {
  const out: number[] = [];
  for (let ts = Math.floor(after / stepMs) * stepMs + stepMs; ts <= until; ts += stepMs) out.push(ts);
  return out;
}
