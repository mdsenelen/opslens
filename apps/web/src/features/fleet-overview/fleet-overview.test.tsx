import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "@/lib/api-client";
import { getServices, type ServiceListItem, type ServiceListResponse } from "@/lib/services-client";
import { renderWithNavigation } from "@/test/mock-navigation";
import { FleetOverview } from "./fleet-overview";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
}));

vi.mock("@/lib/services-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services-client")>();
  return { ...actual, getServices: vi.fn() };
});

const mockedGetServices = vi.mocked(getServices);

function service(overrides: Partial<ServiceListItem> = {}): ServiceListItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "payments-api",
    slug: "payments-api",
    description: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    activeAlertCount: 0,
    ...overrides,
  };
}

function response(items: ServiceListItem[]): ServiceListResponse {
  return { items, page: 1, limit: 25, total: items.length };
}

const networkError: ApiError = { kind: "network", message: "fetch failed" };

// Priority 1 from docs/spec/09-testing.md: the loading/error/empty/ready
// state machine every fetch-backed screen shares — this is the screen most
// likely to silently regress, per that doc's own risk ranking.
describe("FleetOverview", () => {
  beforeEach(() => {
    mockedGetServices.mockReset();
  });

  it("renders the ready state as a linked table row when data is present", () => {
    renderWithNavigation(<FleetOverview initialData={response([service({ activeAlertCount: 2 })])} />);

    expect(screen.getByRole("cell", { name: "payments-api" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "payments-api" })).toHaveAttribute("href", "/services/11111111-1111-1111-1111-111111111111");
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("pairs a nonzero alert count with an aria-hidden icon, not color alone (docs/spec/11-accessibility.md)", () => {
    renderWithNavigation(<FleetOverview initialData={response([service({ activeAlertCount: 3 })])} />);
    const cell = screen.getByRole("cell", { name: "3" });
    expect(cell.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("renders a zero alert count as plain text with no icon badge", () => {
    renderWithNavigation(<FleetOverview initialData={response([service({ activeAlertCount: 0 })])} />);
    const cell = screen.getByRole("cell", { name: "0" });
    expect(cell.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it("renders the empty state when the filtered list has no items", () => {
    renderWithNavigation(<FleetOverview initialData={response([])} />);
    expect(screen.getByText("No services match these filters.")).toBeInTheDocument();
  });

  it("renders the error state from the initial fetch, and recovers on retry", async () => {
    const user = userEvent.setup();
    mockedGetServices.mockResolvedValueOnce(response([service()]));

    renderWithNavigation(<FleetOverview initialData={networkError} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Can't reach the API — fetch failed.");

    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByRole("cell", { name: "payments-api" })).toBeInTheDocument());
  });

  it("shows a loading state while a filter-triggered refetch is in flight", async () => {
    const user = userEvent.setup();
    let resolveFetch!: (value: ServiceListResponse) => void;
    mockedGetServices.mockReturnValueOnce(new Promise((resolve) => (resolveFetch = resolve)));

    renderWithNavigation(<FleetOverview initialData={response([service()])} />);
    await user.type(screen.getByLabelText("Search"), "x");

    expect(await screen.findByRole("status")).toHaveTextContent("Loading services…");

    resolveFetch(response([service({ name: "other-service" })]));
    await waitFor(() => expect(screen.getByRole("cell", { name: "other-service" })).toBeInTheDocument());
  });

  it("wires the environment filter to URL state (docs/spec/04-frontend-architecture.md)", async () => {
    const user = userEvent.setup();
    mockedGetServices.mockResolvedValue(response([service()]));

    const { push } = renderWithNavigation(<FleetOverview initialData={response([service()])} />);
    await user.selectOptions(screen.getByLabelText("Environment"), "production");

    expect(push).toHaveBeenCalledWith("/?environment=production");
  });
});
