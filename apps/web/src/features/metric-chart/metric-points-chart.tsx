"use client";

import "uplot/dist/uPlot.min.css";
import uPlot from "uplot";
import { useEffect, useRef } from "react";
import styles from "./metric-points-chart.module.css";

export type SeriesPoint = { ts: number; value: number };
export type DeploymentMarker = { id: string; ts: number; version: string; status: string };
export type Threshold = { value: number; label: string };

const HEIGHT = 340;

type ChartTheme = { line: string; fill: string; grid: string; axis: string; deploy: string; threshold: string; font: string };

// uPlot paints to a canvas, which can't read CSS custom properties, so the
// design tokens from globals.css are resolved once at mount and handed to
// it as plain colors. Fallbacks keep jsdom (no stylesheet) and a missing
// token from producing an invisible chart.
function readTheme(el: HTMLElement): ChartTheme {
  const css = getComputedStyle(el);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    line: token("--chart-line", "#2448c9"),
    fill: token("--chart-fill", "rgba(36,72,201,0.1)"),
    grid: token("--chart-grid", "#eceef2"),
    axis: token("--chart-axis", "#5f6876"),
    deploy: token("--chart-deploy", "#855209"),
    threshold: token("--chart-threshold", "#b42318"),
    font: css.fontFamily || "system-ui, sans-serif",
  };
}

// Draws deployment markers and the alert threshold directly on uPlot's
// canvas via its draw hook, the standard, documented way to add
// annotations in uPlot without hand-computing DOM overlay positions
// (device-pixel-ratio-aware valToPos(..., true) is exactly what the draw
// hook's canvas context already expects). Each marker is labelled with its
// version, so the line can be matched to the deployment list without
// relying on its color.
function annotationsPlugin(getDeployments: () => DeploymentMarker[], getThreshold: () => number | undefined, theme: ChartTheme): uPlot.Plugin {
  return {
    hooks: {
      draw: [
        (u) => {
          const { ctx } = u;
          const dpr = window.devicePixelRatio || 1;
          ctx.save();
          ctx.lineWidth = 1.5 * dpr;
          ctx.font = `600 ${11 * dpr}px ${theme.font}`;
          ctx.textBaseline = "top";
          // uPlot leaves textAlign set from drawing its axes ("center"),
          // which would straddle each label across its own marker line.
          ctx.textAlign = "left";

          ctx.strokeStyle = theme.deploy;
          ctx.fillStyle = theme.deploy;
          ctx.setLineDash([5 * dpr, 4 * dpr]);
          for (const deployment of getDeployments()) {
            const x = u.valToPos(deployment.ts / 1000, "x", true);
            if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top);
            ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
            const label = deployment.version;
            const labelWidth = ctx.measureText(label).width;
            // Flip the label to the left of the line near the right edge
            // so it never runs off the plot area.
            const labelX = x + 6 * dpr + labelWidth > u.bbox.left + u.bbox.width ? x - 6 * dpr - labelWidth : x + 6 * dpr;
            ctx.fillText(label, labelX, u.bbox.top + 4 * dpr);
          }

          const threshold = getThreshold();
          if (threshold !== undefined) {
            const y = u.valToPos(threshold, "y", true);
            if (y >= u.bbox.top && y <= u.bbox.top + u.bbox.height) {
              ctx.strokeStyle = theme.threshold;
              ctx.fillStyle = theme.threshold;
              ctx.setLineDash([2 * dpr, 3 * dpr]);
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, y);
              ctx.lineTo(u.bbox.left + u.bbox.width, y);
              ctx.stroke();
              ctx.textBaseline = "bottom";
              const label = `threshold ${threshold}`;
              ctx.fillText(label, u.bbox.left + u.bbox.width - ctx.measureText(label).width - 4 * dpr, y - 4 * dpr);
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

    const theme = readTheme(containerRef.current);
    const axis = {
      stroke: theme.axis,
      font: `12px ${theme.font}`,
      grid: { stroke: theme.grid, width: 1 },
      ticks: { stroke: theme.grid, width: 1 },
    };
    const chart = new uPlot(
      {
        width: containerRef.current.clientWidth || 640,
        height: HEIGHT,
        scales: { x: { time: true } },
        series: [{}, { label: unit, stroke: theme.line, width: 2, fill: theme.fill, points: { show: false } }],
        axes: [axis, { ...axis, size: 56 }],
        legend: { show: false },
        cursor: { points: { size: 8, fill: theme.line } },
        plugins: [
          annotationsPlugin(
            () => deploymentsRef.current,
            () => thresholdRef.current,
            theme,
          ),
        ],
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
