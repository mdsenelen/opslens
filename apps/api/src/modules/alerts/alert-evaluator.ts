import type { AlertComparator } from "@opslens/shared-types";

export type EvaluationPoint = { ts: Date; value: number };
export type EvaluationRule = { comparator: AlertComparator; threshold: number; durationSeconds: number };

// Default recency tolerance: comfortably covers the seed's 1-minute
// production ingestion cadence plus the 60-second evaluation tick in
// server.ts, without being so loose that genuinely stale data reads as
// current.
export const DEFAULT_RECENCY_TOLERANCE_MS = 90_000;

/**
 * A rule fires only when the complete trailing duration is represented by
 * observed violating points spanning its start and end. Missing data is
 * deliberately non-violating (the evaluator does not infer cadence). The
 * latest point must be within recencyToleranceMs of evaluatedAt — an
 * ingestion cadence always trails the evaluation instant by some amount,
 * so requiring a point at-or-after the exact instant would practically
 * never be satisfied.
 * The evaluator is pure: repeated calls with the same inputs produce the
 * same result. Persistence deduplicates against an existing open alert.
 */
export function evaluateRule(rule: EvaluationRule, points: EvaluationPoint[], evaluatedAt: Date, recencyToleranceMs = DEFAULT_RECENCY_TOLERANCE_MS): boolean {
  const start = evaluatedAt.getTime() - rule.durationSeconds * 1000;
  const violates = (value: number) => ({ gt:value > rule.threshold, gte:value >= rule.threshold, lt:value < rule.threshold, lte:value <= rule.threshold })[rule.comparator];
  const window = points.filter((point) => point.ts.getTime() >= start && point.ts.getTime() <= evaluatedAt.getTime()).sort((a,b) => a.ts.getTime()-b.ts.getTime());
  return window.length > 0 && window[0]!.ts.getTime() <= start && window.at(-1)!.ts.getTime() >= evaluatedAt.getTime() - recencyToleranceMs && window.every((point) => violates(point.value));
}
