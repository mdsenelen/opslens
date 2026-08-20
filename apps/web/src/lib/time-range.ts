/** Plain helper, not a component — keeps the impure Date.now() call out of
 * page/component bodies (eslint's react-hooks/purity rule flags it there). */
export function defaultTimeRange(windowHours: number): { start: string; end: string } {
  const now = Date.now();
  return {
    start: new Date(now - windowHours * 3600_000).toISOString(),
    end: new Date(now).toISOString(),
  };
}
