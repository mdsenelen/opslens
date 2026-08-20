"use client";

import "uplot/dist/uPlot.min.css";
import uPlot from "uplot";
import { useEffect, useRef } from "react";
import styles from "./metric-points-chart.module.css";

export type SeriesPoint = { ts: number; value: number };
export type DeploymentMarker = { id: string; ts: number; version: string; status: string };
export type Threshold = { value: number; label: string };

const HEIGHT = 320;

// Draws deployment markers and the alert threshold directly on uPlot's
// canvas via its draw hook — the standard, documented way to add
// annotations in uPlot without hand-computing DOM overlay positions
// (device-pixel-ratio-aware valToPos(..., true) is exactly what the draw
// hook's canvas context already expects).
function annotationsPlugin(getDeployments: () => DeploymentMarker[], getThreshold: () => number | undefined): uPlot.Plugin {
  return {
    hooks: {
      draw: [
        (u) => {
          const { ctx } = u;
          ctx.save();

          ctx.strokeStyle = "#8a5a0a";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          for (const deployment of getDeployments()) {
            const x = u.valToPos(deployment.ts / 1000, "x", true);
            if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top);
            ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
          }

          const threshold = getThreshold();
          if (threshold !== undefined) {
            const y = u.valToPos(threshold, "y", true);
            if (y >= u.bbox.top && y <= u.bbox.top + u.bbox.height) {
              ctx.strokeStyle = "#8a2a1f";
              ctx.setLineDash([2, 2]);
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, y);
              ctx.lineTo(u.bbox.left + u.bbox.width, y);
              ctx.stroke();
            }
          }

          ctx.restore();
        },
      ],
    },
  };
}

/**
 * uPlot is not a React component — it owns a canvas imperatively. The
 * instance is created once on mount and updated via setData()/redraw()
 * afterwards; it is never recreated on a data prop change. That distinction
 * is the entire reason uPlot was chosen over an SVG chart library (see
 * docs/spec/05-visualization.md) — once real-time-pushed points start
 * arriving (docs/spec/06), a prop-driven remount would repaint the whole
 * chart on every point instead of a cheap imperative append.
 */
export function MetricPointsChart({
  points,
  deployments,
  threshold,
  unit,
}: {
  points: SeriesPoint[];
  deployments: DeploymentMarker[];
  threshold?: Threshold;
  unit: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const deploymentsRef = useRef(deployments);
  const thresholdRef = useRef(threshold?.value);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = new uPlot(
      {
        width: containerRef.current.clientWidth || 640,
        height: HEIGHT,
        scales: { x: { time: true } },
        series: [{}, { label: unit, stroke: "#1f5ade", width: 2, fill: "rgba(31,90,222,0.1)" }],
        axes: [{}, { size: 60 }],
        legend: { show: false },
        plugins: [annotationsPlugin(() => deploymentsRef.current, () => thresholdRef.current)],
      },
      [[], []],
      containerRef.current,
    );
    chartRef.current = chart;

    const onResize = () => {
      if (containerRef.current) chart.setSize({ width: containerRef.current.clientWidth, height: HEIGHT });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.destroy();
      chartRef.current = null;
    };
    // Mount/teardown only — unit and the plugin's closures over the refs
    // above are the only things this effect needs, and unit never changes
    // for a given metric.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chartRef.current?.setData([points.map((p) => p.ts / 1000), points.map((p) => p.value)]);
  }, [points]);

  useEffect(() => {
    // Refs must only be written in an effect or event handler, not during
    // render — this effect syncs both refs and then triggers the repaint
    // that reads them (via the plugin's closures), in that order, in one
    // commit. redraw(false) skips the path recomputation setData already
    // triggers; deployment/threshold changes don't touch series data.
    deploymentsRef.current = deployments;
    thresholdRef.current = threshold?.value;
    chartRef.current?.redraw(false);
  }, [deployments, threshold]);

  return <div ref={containerRef} className={styles.canvasHost} />;
}
