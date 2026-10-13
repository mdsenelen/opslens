import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiError } from "./api-client";
import { useApiResource } from "./use-api-resource";

const serverError: ApiError = { kind: "server", status: 503, message: "api responded with 503" };

describe("useApiResource refresh", () => {
  it("keeps the current data on screen while refreshing, then swaps in the new data", async () => {
    let resolve: (value: string) => void = () => {};
    const fetcher = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const { result } = renderHook(() => useApiResource(fetcher, "first"));

    act(() => result.current[2]());
    // No loading state in between: a live view refreshing every minute
    // would otherwise blank (and remount) its chart every minute.
    expect(result.current[0]).toEqual({ status: "ready", data: "first" });

    await act(async () => resolve("second"));
    expect(result.current[0]).toEqual({ status: "ready", data: "second" });
  });

  it("keeps the last good data when a background refresh fails", async () => {
    const fetcher = vi.fn(async (): Promise<string | ApiError> => serverError);
    const { result } = renderHook(() => useApiResource(fetcher, "first"));

    await act(async () => result.current[2]());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toEqual({ status: "ready", data: "first" });
  });

  it("ignores a response that arrives after a newer request has started", async () => {
    const resolvers: ((value: string) => void)[] = [];
    const fetcher = vi.fn(() => new Promise<string>((r) => resolvers.push(r)));
    const { result } = renderHook(() => useApiResource(fetcher, "first"));

    act(() => result.current[2]());
    act(() => result.current[2]());
    await act(async () => resolvers[1]!("newer"));
    await act(async () => resolvers[0]!("older"));

    await waitFor(() => expect(result.current[0]).toEqual({ status: "ready", data: "newer" }));
  });
});
