import type { AlertComparator, AlertSeverity, EnvironmentName, MetricKind } from "@opslens/shared-types";

/**
 * The fleet both data writers describe: seed.ts (the fixed regression
 * scenario the tests depend on) and the live simulation
 * (modules/simulation). Kept in one place so the two can never disagree
 * about which services, metrics, thresholds or cadences exist.
 */

export type ServiceSeed = { slug: string; name: string; description: string };

export const SERVICES: ServiceSeed[] = [
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

export const ENVIRONMENTS: EnvironmentName[] = [
  "production",
  "staging",
  "development",
];

export type MetricDef = {
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

export const METRIC_DEFS: MetricDef[] = [
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
export const DATA_ENVIRONMENTS: {
  name: EnvironmentName;
  windowHours: number;
  stepMinutes: number;
}[] = [
  { name: "production", windowHours: 24, stepMinutes: 1 },
  { name: "staging", windowHours: 24, stepMinutes: 5 },
];
