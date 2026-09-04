import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useConnectionAnnouncements, type RealtimeConnectionState } from "./realtime-client";

// docs/spec/11-accessibility.md's polite-live-region requirement, extended
// this phase to connection state — a screen-reader user has no equivalent
// of the visual "Live updates paused" badge without this. Deliberately
// narrow: only "reached lost" and "recovered from lost" are announced, not
// the initial connect or the interim "reconnecting" flaps (see the hook's
// own comment for why).
describe("useConnectionAnnouncements", () => {
  it("does not announce the initial connect", () => {
    const announce = vi.fn();
    const { rerender } = renderHook(({ state }) => useConnectionAnnouncements(state, announce), {
      initialProps: { state: "connecting" as RealtimeConnectionState },
    });

    rerender({ state: "open" });

    expect(announce).not.toHaveBeenCalled();
  });

  it("announces once the connection is lost", () => {
    const announce = vi.fn();
    const { rerender } = renderHook(({ state }) => useConnectionAnnouncements(state, announce), {
      initialProps: { state: "open" as RealtimeConnectionState },
    });

    rerender({ state: "reconnecting" });
    rerender({ state: "lost" });

    expect(announce).toHaveBeenCalledExactlyOnceWith("Live updates paused.");
  });

  it("does not announce the interim reconnecting state on its own", () => {
    const announce = vi.fn();
    const { rerender } = renderHook(({ state }) => useConnectionAnnouncements(state, announce), {
      initialProps: { state: "open" as RealtimeConnectionState },
    });

    rerender({ state: "reconnecting" });

    expect(announce).not.toHaveBeenCalled();
  });

  it("announces recovery only once the connection had actually been lost", () => {
    const announce = vi.fn();
    const { rerender } = renderHook(({ state }) => useConnectionAnnouncements(state, announce), {
      initialProps: { state: "lost" as RealtimeConnectionState },
    });

    rerender({ state: "open" });

    expect(announce).toHaveBeenCalledExactlyOnceWith("Live updates resumed.");
  });
});
