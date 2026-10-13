import type { MetricPoint } from "@opslens/shared-types";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAlert, getAlerts } from "@/lib/alerts-client";
import { getDeployments } from "@/lib/deployments-client";
import { getMetricPoints, METRIC_POINT_LIMIT, type MetricPointsResponse } from "@/lib/metrics-client";
import { renderWithNavigation } from "@/test/mock-navigation";
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
const uplot = vi.hoisted(() => ({ constructed: 0 }));
vi.mock("uplot", () => ({
  default: class FakeUPlot {
    constructor() {
      uplot.constructed++;
    }
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

  it("says so when the window holds more points than one request returns, and stays quiet otherwise", () => {
    const props = {
      serviceId: "33333333-3333-3333-3333-333333333333",
      metricId: "11111111-1111-1111-1111-111111111111",
      environment: "production" as const,
      start: "2026-08-24T00:00:00.000Z",
      end: "2026-08-25T00:00:00.000Z",
    };
    const { unmount } = render(<MetricChart {...props} initialData={response(points)} />);
    expect(screen.queryByText(/Showing the most recent/)).not.toBeInTheDocument();
    unmount();

    const full = Array.from({ length: METRIC_POINT_LIMIT }, (_, i) => point(new Date(Date.UTC(2026, 7, 24, 0, i)).toISOString(), 1));
    render(<MetricChart {...props} initialData={response(full)} />);
    expect(screen.getByText(/Showing the most recent 1000 points/)).toBeInTheDocument();
  });
});

describe("MetricChart live ranges", () => {
  const ids = { serviceId: "33333333-3333-3333-3333-333333333333", metricId: "11111111-1111-1111-1111-111111111111", environment: "production" as const };
  const start = "2026-08-24T11:00:00.000Z";
  const end = "2026-08-24T12:00:00.000Z";
  const initial = response([point("2026-08-24T11:59:00.000Z", 1)]);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(end));
    uplot.constructed = 0;
    mockedGetMetricPoints.mockReset().mockResolvedValue(response([point("2026-08-24T11:59:00.000Z", 1), point("2026-08-24T12:00:00.000Z", 2)]));
    mockedGetDeployments.mockReset().mockResolvedValue({ items: [], page: 1, limit: 100, total: 0 });
    mockedGetAlerts.mockReset().mockResolvedValue({ items: [], page: 1, limit: 100, total: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-fetches a relative range every minute with the window moved to now, without a loading state or a chart remount", async () => {
    render(<MetricChart {...ids} range="1h" start={start} end={end} initialData={initial} />);
    expect(screen.getByText("Updates every minute")).toBeInTheDocument();
    mockedGetMetricPoints.mockClear();

    await act(async () => vi.advanceTimersByTimeAsync(60_000));

    expect(mockedGetMetricPoints).toHaveBeenCalledWith(ids.metricId, expect.objectContaining({ start: "2026-08-24T11:01:00.000Z", end: "2026-08-24T12:01:00.000Z" }));
    expect(mockedGetDeployments).toHaveBeenLastCalledWith(expect.objectContaining({ start: "2026-08-24T11:01:00.000Z", end: "2026-08-24T12:01:00.000Z" }));
    expect(screen.queryByText("Loading metric data…")).not.toBeInTheDocument();
    expect(screen.getByText("2 points from", { exact: false })).toBeInTheDocument();
    expect(uplot.constructed).toBe(1);
  });

  it("leaves a fixed start/end window alone, so a shared investigation link does not drift", async () => {
    render(<MetricChart {...ids} start={start} end={end} initialData={initial} />);
    mockedGetMetricPoints.mockClear();

    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));

    expect(mockedGetMetricPoints).not.toHaveBeenCalled();
    expect(screen.queryByText("Updates every minute")).not.toBeInTheDocument();
  });

  it("switches to a relative range from the presets, dropping any fixed window from the URL", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const { push } = renderWithNavigation(<MetricChart {...ids} start={start} end={end} initialData={initial} />, `environment=production&start=${start}&end=${end}`);

    await user.click(screen.getByRole("button", { name: "6h" }));

    expect(push).toHaveBeenCalledWith("/?environment=production&range=6h");
  });

  it("marks the relative range as the pressed preset", () => {
    render(<MetricChart {...ids} range="6h" start={start} end={end} initialData={initial} />);
    expect(screen.getByRole("button", { name: "6h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "false");
  });
});
