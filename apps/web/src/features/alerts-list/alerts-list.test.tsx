import type { Alert } from "@opslens/shared-types";
import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAlerts, type AlertListItem, type AlertListResponse } from "@/lib/alerts-client";
import { useConnectionAnnouncements, useRealtimeAlerts, type RealtimeConnectionState } from "@/lib/realtime-client";
import { getServices } from "@/lib/services-client";
import { renderWithNavigation } from "@/test/mock-navigation";
import { AlertsList } from "./alerts-list";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
}));

vi.mock("@/lib/alerts-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alerts-client")>();
  return { ...actual, getAlerts: vi.fn() };
});

vi.mock("@/lib/services-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services-client")>();
  return { ...actual, getServices: vi.fn() };
});

vi.mock("@/lib/realtime-client", () => ({ useRealtimeAlerts: vi.fn(), useConnectionAnnouncements: vi.fn() }));

const mockedGetAlerts = vi.mocked(getAlerts);
const mockedGetServices = vi.mocked(getServices);
const mockedUseRealtimeAlerts = vi.mocked(useRealtimeAlerts);
const mockedUseConnectionAnnouncements = vi.mocked(useConnectionAnnouncements);

function makeAlert(overrides: Partial<AlertListItem> = {}): AlertListItem {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    alertRuleId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    serviceId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    environmentId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    status: "firing",
    firedAt: "2026-08-24T00:00:00.000Z",
    acknowledgedAt: null,
    resolvedAt: null,
    severity: "critical",
    metricName: "error_rate_pct",
    serviceName: "payments-api",
    environmentName: "production",
    ...overrides,
  };
}

function response(items: AlertListItem[]): AlertListResponse {
  return { items, page: 1, limit: 25, total: items.length };
}

// Priority 3's third item in docs/spec/09-testing.md: "the alert-status live
// region ... a11y regressions in live-updating content are easy to
// introduce silently." Covers the aria-live="polite" announcement and the
// non-color connection-status indicator from docs/spec/11-accessibility.md.
describe("AlertsList", () => {
  beforeEach(() => {
    mockedGetAlerts.mockReset();
    mockedGetServices.mockReset().mockResolvedValue({ items: [], page: 1, limit: 100, total: 0 });
    mockedUseRealtimeAlerts.mockReset().mockReturnValue("open" as RealtimeConnectionState);
    mockedUseConnectionAnnouncements.mockReset();
  });

  it("announces a status transition in the polite live region and refetches the filtered list", async () => {
    let emitChange!: (alert: Alert) => void;
    mockedUseRealtimeAlerts.mockImplementation((_serviceId, onAlertChange) => {
      emitChange = onAlertChange;
      return "open";
    });
    mockedGetAlerts.mockResolvedValueOnce(response([makeAlert({ status: "resolved" })]));

    renderWithNavigation(<AlertsList initialData={response([makeAlert()])} />);

    act(() => emitChange({ ...makeAlert(), status: "resolved" }));

    // useLiveAnnouncer throttles by DEFAULT_THROTTLE_MS (lib/use-live-announcer.ts)
    // before flushing, so this needs more than waitFor's default 1000ms budget.
    await waitFor(() => expect(screen.getByText("An alert is now resolved.")).toBeInTheDocument(), { timeout: 3000 });
    expect(mockedGetAlerts).toHaveBeenCalledTimes(1);
  });

  it("shows a non-color connection-status indicator once the live connection is lost", () => {
    mockedUseRealtimeAlerts.mockReturnValue("lost");
    renderWithNavigation(<AlertsList initialData={response([makeAlert()])} />);
    expect(screen.getByText("Live updates paused")).toBeInTheDocument();
  });

  it("does not show a connection badge while the stream is open", () => {
    renderWithNavigation(<AlertsList initialData={response([makeAlert()])} />);
    expect(screen.queryByText(/Live updates paused|Reconnecting|Connecting to live updates/)).not.toBeInTheDocument();
  });
});
