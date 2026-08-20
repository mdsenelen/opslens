import { describe, expect, it } from "vitest";
import { evaluateRule } from "./alert-evaluator";

const now = new Date("2026-08-20T12:00:00.000Z");
const point = (secondsAgo: number, value: number) => ({ ts: new Date(now.getTime() - secondsAgo * 1000), value });

describe("evaluateRule", () => {
  const rule = { comparator: "gt" as const, threshold: 5, durationSeconds: 180 };

  it("fires deterministically for the seeded payments error-rate shape", () => {
    const points = [point(180, 9), point(120, 9.1), point(60, 8.9), point(0, 9)];
    expect(evaluateRule(rule, points, now)).toBe(true);
    expect(evaluateRule(rule, [...points].reverse(), now)).toBe(true);
  });

  it("does not fire for a gap or a non-violating point", () => {
    expect(evaluateRule(rule, [point(120, 9), point(0, 9)], now)).toBe(false);
    expect(evaluateRule(rule, [point(180, 9), point(60, 4), point(0, 9)], now)).toBe(false);
  });

  it("fires when the latest point trails evaluatedAt by less than the recency tolerance", () => {
    // Realistic ingestion cadence: the newest point is 30s old, not exactly
    // at evaluatedAt. Before the recency-tolerance fix this never fired.
    const points = [point(180, 9), point(120, 9.1), point(60, 8.9), point(30, 9)];
    expect(evaluateRule(rule, points, now)).toBe(true);
  });

  it("does not fire when the latest point is older than the recency tolerance", () => {
    // Newest point is 5 minutes stale — the window itself is otherwise
    // violating, but the data is too old to trust as "currently firing".
    const points = [point(480, 9), point(420, 9.1), point(360, 8.9), point(300, 9)];
    expect(evaluateRule(rule, points, now)).toBe(false);
  });

  it("respects a custom recency tolerance", () => {
    const points = [point(180, 9), point(120, 9.1), point(60, 8.9), point(30, 9)];
    expect(evaluateRule(rule, points, now, 10_000)).toBe(false);
    expect(evaluateRule(rule, points, now, 60_000)).toBe(true);
  });
});
