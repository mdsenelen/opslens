import type { MetricPoint } from "@opslens/shared-types";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAlert, getAlerts } from "@/lib/alerts-client";
import { getDeployments } from "@/lib/deployments-client";
import { getMetricPoints, type MetricPointsResponse } from "@/lib/metrics-client";
import { MetricChart } from "./metric-chart";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
}));

// metric-points-chart.test.tsx already covers the uPlot wrapper itself in
// depth (instance-reuse, setData/redraw) — here uplot is mocked to the bare
// minimum needed for MetricChart (the container) to mount at all.
vi.mock("uplot/dist/uPlot.min.css", () => ({}));
vi.mock("uplot", () => ({
  default: class FakeUPlot {
    setData() {}
    setSize() {}
    redraw() {}
    destroy() {}
  },
}));

vi.mock("@/lib/metrics-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/metrics-client")>();
  return { ...actual, getMetricPoints: vi.fn() };
});
vi.mock("@/lib/deployments-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deployments-client")>();
  return { ...actual, getDeployments: vi.fn() };
});
vi.mock("@/lib/alerts-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alerts-client")>();
  return { ...actual, getAlerts: vi.fn(), getAlert: vi.fn() };
});

const mockedGetMetricPoints = vi.mocked(getMetricPoints);
const mockedGetDeployments = vi.mocked(getDeployments);
const mockedGetAlerts = vi.mocked(getAlerts);
const mockedGetAlert = vi.mocked(getAlert);

function point(ts: string, value: number): MetricPoint {
  return { id: ts, metricId: "11111111-1111-1111-1111-111111111111", environmentId: "22222222-2222-2222-2222-222222222222", ts, value };
}

function response(points: MetricPoint[]): MetricPointsResponse {
  return {
    metric: { id: "11111111-1111-1111-1111-111111111111", serviceId: "33333333-3333-3333-3333-333333333333", name: "error_rate_pct", unit: "%", kind: "gauge", createdAt: "2026-01-01T00:00:00.000Z" },
    environment: { id: "22222222-2222-2222-2222-222222222222", name: "production" },
    points,
    limit: 1000,
  };
}

// docs/spec/11-accessibility.md's "Metric chart" section: the numeric value
// driving an alert (current value vs. threshold) must be stated as text,
// and the series must be reachable off-canvas — MetricSummary and the
// <details> table added this phase (metric-chart.tsx).
describe("MetricChart", () => {
  const points = [point("2026-08-24T00:00:00.000Z", 1), point("2026-08-24T00:05:00.000Z", 9)];

  beforeEach(() => {
    // Not expected to be called at all — useApiResource skips its initial
    // effect when initialData is given (lib/use-api-resource.ts) — but
    // resolved defensively in case a re-render ever triggers a real refetch.
    mockedGetMetricPoints.mockReset().mockResolvedValue(response(points));
    mockedGetDeployments.mockReset().mockResolvedValue({ items: [], page: 1, limit: 100, total: 0 });
    mockedGetAlerts.mockReset().mockResolvedValue({ items: [], page: 1, limit: 100, total: 0 });
    mockedGetAlert.mockReset();
  });

  it("states the series' range and latest value as text, not only on the canvas", () => {
    render(
      <MetricChart serviceId="33333333-3333-3333-3333-333333333333" metricId="11111111-1111-1111-1111-111111111111" environment="production" start="2026-08-24T00:00:00.000Z" end="2026-08-24T01:00:00.000Z" initialData={response(points)} />,
    );

    // The dates in between are locale-formatted (toLocaleString) and
    // deliberately not asserted on here — the count/range/latest-value
    // wording around them is what this test protects.
    expect(screen.getByText("2 points from", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("ranging 1–9 %. Latest value:", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("9 %")).toBeInTheDocument();
  });

  it("keeps the accessible points table collapsed until opened, then shows the same series as a real table", async () => {
    const user = userEvent.setup();
    render(
      <MetricChart serviceId="33333333-3333-3333-3333-333333333333" metricId="11111111-1111-1111-1111-111111111111" environment="production" start="2026-08-24T00:00:00.000Z" end="2026-08-24T01:00:00.000Z" initialData={response(points)} />,
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await user.click(screen.getByText(/Show data as a table/));

    const table = screen.getByRole("table");
    // header row + one row per point
    expect(within(table).getAllByRole("row")).toHaveLength(points.length + 1);
    expect(within(table).getByRole("cell", { name: "1" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "9" })).toBeInTheDocument();
  });
});
