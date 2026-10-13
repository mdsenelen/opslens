import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveAnnouncer } from "./use-live-announcer";

// The coalescing behavior alerts-list.tsx and alert-detail.tsx both rely on
// (docs/spec/11-accessibility.md's polite-live-region requirement) — tested
// in isolation here since the timing is exact and easy to get wrong through
// a full component render.
describe("useLiveAnnouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with no announcement", () => {
    const { result } = renderHook(() => useLiveAnnouncer(1500));
    expect(result.current[0]).toBe("");
  });

  it("announces a single message once the throttle window elapses, not immediately", () => {
    const { result } = renderHook(() => useLiveAnnouncer(1500));

    act(() => result.current[1]("An alert is now resolved."));
    expect(result.current[0]).toBe("");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current[0]).toBe("An alert is now resolved.");
  });

  it("coalesces messages that arrive inside one window into a single announcement", () => {
    const { result } = renderHook(() => useLiveAnnouncer(1500));

    act(() => {
      result.current[1]("An alert is now resolved.");
      result.current[1]("An alert is now firing.");
      vi.advanceTimersByTime(1500);
    });

    expect(result.current[0]).toBe("An alert is now resolved. An alert is now firing.");
  });

  it("starts a fresh throttle window after each flush", () => {
    const { result } = renderHook(() => useLiveAnnouncer(1500));

    act(() => {
      result.current[1]("First.");
      vi.advanceTimersByTime(1500);
    });
    expect(result.current[0]).toBe("First.");

    act(() => {
      result.current[1]("Second.");
      vi.advanceTimersByTime(1500);
    });
    expect(result.current[0]).toBe("Second.");
  });
});
