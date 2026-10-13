import { describe, expect, it } from "vitest";
import { METRIC_DEFS, SERVICES } from "./catalog";
import { deploymentsBetween, incidentForPeriod, incidentsBetween, PERIOD_MS, timestampsBetween, valueAt } from "./scenario";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const errorRate = METRIC_DEFS.find((m) => m.name === "error_rate_pct")!;
const latency = METRIC_DEFS.find((m) => m.name === "p95_latency_ms")!;
// Any fixed instant works; the scenario has no "start" date.
const t0 = Date.UTC(2026, 9, 13, 0, 0, 0);

describe("simulation scenario", () => {
  it("is a pure function of time: the same instant always gives the same value", () => {
    for (const service of SERVICES) {
      for (const metric of METRIC_DEFS) {
        expect(valueAt(service.slug, metric, "production", t0 + 7 * MINUTE)).toBe(valueAt(service.slug, metric, "production", t0 + 7 * MINUTE));
      }
    }
  });

  it("keeps normal traffic below every alert threshold for a full week", () => {
    for (let t = t0; t < t0 + 7 * 24 * HOUR; t += MINUTE) {
      for (const service of SERVICES) {
        for (const metric of METRIC_DEFS) {
          for (const env of ["production", "staging"] as const) {
            const incident = incidentForPeriod(Math.floor(t / PERIOD_MS));
            const inSpike = env === "production" && incident.serviceSlug === service.slug && t >= incident.spikeStart && t < incident.spikeEnd;
            if (inSpike) continue;
            expect(valueAt(service.slug, metric, env, t)).toBeLessThan(metric.alertThreshold);
          }
        }
      }
    }
  });

  it("violates both rules for longer than their durations during every incident, then recovers", () => {
    for (const incident of incidentsBetween(t0, t0 + 24 * HOUR)) {
      const spikeMinutes = timestampsBetween(incident.spikeStart - 1, incident.spikeEnd - 1, MINUTE);
      expect((incident.spikeEnd - incident.spikeStart) / 1000).toBeGreaterThan(Math.max(errorRate.alertDurationSeconds, latency.alertDurationSeconds));
      for (const ts of spikeMinutes) {
        expect(valueAt(incident.serviceSlug, errorRate, "production", ts)).toBeGreaterThan(errorRate.alertThreshold);
        expect(valueAt(incident.serviceSlug, latency, "production", ts)).toBeGreaterThan(latency.alertThreshold);
      }
      expect(valueAt(incident.serviceSlug, errorRate, "production", incident.spikeEnd)).toBeLessThan(errorRate.alertThreshold);
      // Staging never spikes: the bug only shows under production traffic.
      expect(valueAt(incident.serviceSlug, errorRate, "staging", incident.spikeStart + 5 * MINUTE)).toBeLessThan(errorRate.alertThreshold);
    }
  });

  it("rotates incidents across all four services, one every 3 hours", () => {
    const incidents = incidentsBetween(t0, t0 + 12 * HOUR - 1);
    expect(incidents).toHaveLength(4);
    expect(new Set(incidents.map((i) => i.serviceSlug))).toEqual(new Set(SERVICES.map((s) => s.slug)));
  });

  it("ships the guilty release before the spike, then rolls back to the release before it", () => {
    for (const incident of incidentsBetween(t0, t0 + 24 * HOUR)) {
      const deployments = deploymentsBetween(incident.releasedAt - 12 * HOUR, incident.spikeEnd).filter(
        (d) => d.serviceSlug === incident.serviceSlug && d.environment === "production",
      );
      const release = deployments.find((d) => d.deployedAt === incident.releasedAt)!;
      const rollback = deployments.find((d) => d.deployedAt === incident.rolledBackAt)!;
      const previous = deployments.filter((d) => d.deployedAt < incident.releasedAt).at(-1)!;

      expect(release.kind).toBe("release");
      expect(release.deployedAt).toBeLessThan(incident.spikeStart);
      expect(rollback.kind).toBe("rollback");
      expect(rollback.deployedAt).toBeLessThan(incident.spikeEnd);
      expect(rollback.version).toBe(previous.version);
      expect(rollback.version).not.toBe(release.version);
    }
  });

  it("gives each service strictly increasing release versions", () => {
    const releases = deploymentsBetween(t0, t0 + 3 * 24 * HOUR).filter((d) => d.kind === "release" && d.environment === "production");
    for (const service of SERVICES) {
      const versions = releases.filter((d) => d.serviceSlug === service.slug).map((d) => d.version.slice(1).split(".").map(Number));
      expect(versions.length).toBeGreaterThan(2);
      for (let i = 1; i < versions.length; i++) {
        const [a, b] = [versions[i - 1]!, versions[i]!];
        expect(a[1]! * 10 + a[2]!).toBeLessThan(b[1]! * 10 + b[2]!);
      }
    }
  });

  it("returns each deployment exactly once across adjacent windows", () => {
    const whole = deploymentsBetween(t0, t0 + 24 * HOUR);
    const split = [...deploymentsBetween(t0, t0 + 7 * HOUR + 13 * MINUTE), ...deploymentsBetween(t0 + 7 * HOUR + 13 * MINUTE, t0 + 24 * HOUR)];
    expect(split).toEqual(whole);
  });

  it("lists step-aligned timestamps strictly after the start", () => {
    expect(timestampsBetween(t0 + 30_000, t0 + 3 * MINUTE, MINUTE)).toEqual([t0 + MINUTE, t0 + 2 * MINUTE, t0 + 3 * MINUTE]);
    expect(timestampsBetween(t0, t0, MINUTE)).toEqual([]);
  });
});
