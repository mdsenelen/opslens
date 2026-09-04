import type { Alert } from "@opslens/shared-types";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAlert, type AlertDetail as AlertDetailData } from "@/lib/alerts-client";
import { useConnectionAnnouncements, useRealtimeAlerts, type RealtimeConnectionState } from "@/lib/realtime-client";
import { AlertDetail } from "./alert-detail";

vi.mock("@/lib/alerts-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alerts-client")>();
  return { ...actual, getAlert: vi.fn() };
});

vi.mock("@/lib/realtime-client", () => ({ useRealtimeAlerts: vi.fn(), useConnectionAnnouncements: vi.fn() }));

const mockedGetAlert = vi.mocked(getAlert);
const mockedUseRealtimeAlerts = vi.mocked(useRealtimeAlerts);
const mockedUseConnectionAnnouncements = vi.mocked(useConnectionAnnouncements);

function makeAlert(overrides: Partial<AlertDetailData> = {}): AlertDetailData {
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
    rule: { comparator: "gt", threshold: 5, durationSeconds: 180 },
    ...overrides,
  };
}

// Priority 3 in docs/spec/09-testing.md, extended this phase to the
// connection-state indicator and live region alert-detail.tsx didn't have
// before (docs/spec/11-accessibility.md) — mirrors alerts-list.test.tsx's
// coverage of the same non-color cue/live-region pattern.
describe("AlertDetail", () => {
  beforeEach(() => {
    mockedGetAlert.mockReset();
    mockedUseRealtimeAlerts.mockReset().mockReturnValue("open" as RealtimeConnectionState);
    mockedUseConnectionAnnouncements.mockReset();
  });

  it("does not show a connection badge while the stream is open", () => {
    render(<AlertDetail alertId={makeAlert().id} initialData={makeAlert()} />);
    expect(screen.queryByText(/Live updates paused|Reconnecting|Connecting to live updates/)).not.toBeInTheDocument();
  });

  it("shows a non-color connection-status indicator once the live connection is lost", () => {
    mockedUseRealtimeAlerts.mockReturnValue("lost");
    render(<AlertDetail alertId={makeAlert().id} initialData={makeAlert()} />);
    expect(screen.getByText("Live updates paused")).toBeInTheDocument();
  });

  it("announces a status transition for this alert in the polite live region", async () => {
    const alert = makeAlert();
    let emitChange!: (alert: Alert) => void;
    mockedUseRealtimeAlerts.mockImplementation((_serviceId, onAlertChange) => {
      emitChange = onAlertChange;
      return "open";
    });

    render(<AlertDetail alertId={alert.id} initialData={alert} />);
    act(() => emitChange({ ...alert, status: "resolved" }));

    // Throttled via useLiveAnnouncer (lib/use-live-announcer.ts) — see
    // alerts-list.test.tsx's identical timeout note.
    await waitFor(() => expect(screen.getByText("An alert is now resolved.")).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText("Resolved")).toBeInTheDocument(); // the visible StatusBadge also patches in place
  });

  it("ignores a live event for a different alert", () => {
    const alert = makeAlert();
    let emitChange!: (alert: Alert) => void;
    mockedUseRealtimeAlerts.mockImplementation((_serviceId, onAlertChange) => {
      emitChange = onAlertChange;
      return "open";
    });

    render(<AlertDetail alertId={alert.id} initialData={alert} />);
    act(() => emitChange({ ...alert, id: "other-alert-id", status: "resolved" }));

    expect(screen.getByText("Firing")).toBeInTheDocument();
    expect(screen.queryByText("An alert is now resolved.")).not.toBeInTheDocument();
  });
});
