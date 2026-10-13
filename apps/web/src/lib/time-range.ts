/** Plain helper, not a component — keeps the impure Date.now() call out of
 * page/component bodies (eslint's react-hooks/purity rule flags it there). */
export function defaultTimeRange(windowHours: number): { start: string; end: string } {
  const now = Date.now();
  return {
    start: new Date(now - windowHours * 3600_000).toISOString(),
    end: new Date(now).toISOString(),
  };
}

/**
 * The metric chart's relative ranges. A URL with ?range=<label> (and no
 * start/end) is a live view: the window is recomputed from "now" on every
 * refresh. Kept here, not in the client chart component, because the
 * server route also needs the values: a server component importing a
 * plain value from a "use client" module gets a client reference instead.
 */
export const TIME_RANGE_PRESETS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
] as const;

export type TimeRangePreset = (typeof TIME_RANGE_PRESETS)[number]["label"];

export function parseTimeRangePreset(value: string | undefined): TimeRangePreset | undefined {
  return TIME_RANGE_PRESETS.find((p) => p.label === value)?.label;
}

export function presetHours(label: TimeRangePreset): number {
  return TIME_RANGE_PRESETS.find((p) => p.label === label)!.hours;
}
