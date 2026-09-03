import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetricPointsChart } from "./metric-points-chart";

/**
 * Phase 6 (performance)'s "React render counts on the metric-points chart"
 * item from docs/spec/10-performance.md: a new point arriving must not
 * re-render/remount the chart — uPlot owns the canvas imperatively, updated
 * via setData()/redraw(), not by React recreating the instance on every
 * prop change. That was previously a manual React-DevTools-profiler check;
 * this makes it a permanent regression test instead, mocking "uplot" itself
 * since jsdom has no real canvas 2D context for the genuine library to draw
 * into.
 */
// vi.mock's factory is hoisted above every import (including the class
// below it would otherwise reference), so the class itself has to be
// created inside vi.hoisted to exist by the time the factory runs.
const { FakeUPlot } = vi.hoisted(() => {
  class FakeUPlot {
    static instances = 0;
    static all: FakeUPlot[] = [];
    setDataCalls: unknown[] = [];
    redrawCalls: unknown[] = [];
    destroyed = false;

    constructor(
      public opts: unknown,
      public initialData: unknown,
      public target: HTMLElement,
    ) {
      FakeUPlot.instances += 1;
      FakeUPlot.all.push(this);
    }

    setData(data: unknown) {
      this.setDataCalls.push(data);
    }

    redraw(rebuildPaths?: boolean) {
      this.redrawCalls.push(rebuildPaths);
    }

    setSize() {}

    destroy() {
      this.destroyed = true;
    }
  }
  return { FakeUPlot };
});

vi.mock("uplot/dist/uPlot.min.css", () => ({}));
vi.mock("uplot", () => ({ default: FakeUPlot }));

function point(ts: number, value: number) {
  return { ts, value };
}

describe("MetricPointsChart", () => {
  beforeEach(() => {
    FakeUPlot.instances = 0;
    FakeUPlot.all = [];
  });
  afterEach(cleanup);

  it("constructs the uPlot instance exactly once, regardless of how many times points update", () => {
    const { rerender } = render(<MetricPointsChart points={[point(1000, 1)]} deployments={[]} unit="ms" />);
    expect(FakeUPlot.instances).toBe(1);
    const instance = FakeUPlot.all[0]!;
    expect(instance.setDataCalls).toHaveLength(1);

    rerender(<MetricPointsChart points={[point(1000, 1), point(2000, 2)]} deployments={[]} unit="ms" />);
    rerender(<MetricPointsChart points={[point(1000, 1), point(2000, 2), point(3000, 3)]} deployments={[]} unit="ms" />);

    // Still the same instance — a remount would push FakeUPlot.instances to 3.
    expect(FakeUPlot.instances).toBe(1);
    expect(instance.setDataCalls).toHaveLength(3);
    expect(instance.setDataCalls[2]).toEqual([
      [1, 2, 3],
      [1, 2, 3],
    ]);
  });

  it("pushes deployment/threshold changes through redraw(), not a data update or remount", () => {
    const { rerender } = render(<MetricPointsChart points={[point(1000, 1)]} deployments={[]} unit="ms" />);
    const instance = FakeUPlot.all[0]!;
    expect(instance.redrawCalls).toHaveLength(1); // the deployments/threshold effect also runs once on mount

    rerender(<MetricPointsChart points={[point(1000, 1)]} deployments={[{ id: "d1", ts: 1000, version: "v1", status: "success" }]} threshold={{ value: 5, label: "gt 5" }} unit="ms" />);

    expect(FakeUPlot.instances).toBe(1);
    expect(instance.redrawCalls).toHaveLength(2);
    // points is a new array reference every render (the caller doesn't
    // memoize it), so setData fires here too — the property under test is
    // that it's a setData *call* on the existing instance, never a remount.
    expect(instance.setDataCalls).toHaveLength(2);
  });

  it("destroys the uPlot instance on unmount", () => {
    const { unmount } = render(<MetricPointsChart points={[point(1000, 1)]} deployments={[]} unit="ms" />);
    const instance = FakeUPlot.all[0]!;
    expect(instance.destroyed).toBe(false);
    unmount();
    expect(instance.destroyed).toBe(true);
  });
});
