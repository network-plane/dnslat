import { formatNumber, formatChartXLabel, formatDateTime } from "../format.js";
import { getOrCreateChartTooltip } from "./tooltip.js";
import { setupChartPan, sliceRowsForPan, MIN_POINTS_FOR_PAN } from "./pan.js";
import type {
  TimeSeriesRow,
  RangeKey,
  ChartPanState,
  SeriesDef,
} from "../types.js";

function val(row: TimeSeriesRow, key: string): number {
  const v = row.values[key];
  return v != null && Number.isFinite(v) ? v : 0;
}

export type CombinedChartOptions = {
  range?: RangeKey;
  pan?: ChartPanState;
  onPanChange?: () => void;
  skipPanSetup?: boolean;
  /** default reads localStorage logarithmic-scale */
  useLogarithmic?: boolean;
};

export function renderCombinedChart(
  container: HTMLElement | string,
  rows: TimeSeriesRow[],
  series: SeriesDef[],
  opts: CombinedChartOptions = {}
): void {
  const containerEl =
    typeof container === "string"
      ? document.getElementById(container)
      : container;
  if (!containerEl) throw new Error("renderCombinedChart: missing container");
  containerEl.innerHTML = "";

  const pan = opts.pan;
  const usePan =
    pan &&
    rows.length >= MIN_POINTS_FOR_PAN &&
    opts.onPanChange &&
    !opts.skipPanSetup;
  const usePanSlice =
    pan && rows.length >= MIN_POINTS_FOR_PAN && opts.onPanChange;
  const drawRows = usePanSlice ? sliceRowsForPan(rows, pan!) : rows;
  const chartRange = opts.range ?? "24h";
  const useLogarithmic =
    opts.useLogarithmic ??
    (typeof localStorage !== "undefined" &&
      localStorage.getItem("logarithmic-scale") === "true");

  if (!drawRows.length || series.length === 0) {
    containerEl.textContent = "No data for selected range.";
    return;
  }

  const svgNS = "http://www.w3.org/2000/svg";
  const width = 300;
  const height = 50;
  const paddingLeft = 28;
  const paddingRight = 12;
  const paddingTop = 8;
  const paddingBottom = 20;
  const paddingY = paddingTop;

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.height = "100%";

  const times = drawRows.map((r) => new Date(r.timestamp).getTime());
  const minX = Math.min(...times);
  const maxX = Math.max(...times);

  const metrics = series.map((s) => ({
    ...s,
    values: drawRows.map((r) => val(r, s.key)),
  }));

  const metricRanges = metrics.map((metric) => {
    const vals = metric.values.filter((v) => Number.isFinite(v));
    if (vals.length === 0) {
      if (useLogarithmic) {
        return {
          min: 1,
          max: 10,
          logMin: 0,
          logMax: 1,
          logRange: 1,
          range: 1,
        };
      }
      return { min: 0, max: 1, range: 1 };
    }
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    if (useLogarithmic) {
      const safeMin = Math.max(min, 0.001);
      const logMin = Math.log10(safeMin);
      const logMax = Math.log10(max);
      const logRange = logMax - logMin || 1;
      return { min: safeMin, max, logMin, logMax, logRange, range };
    }
    return { min, max, range };
  });

  const innerW = width - paddingLeft - paddingRight;
  const innerH = height - paddingTop - paddingBottom;
  const tooltip = getOrCreateChartTooltip();

  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = paddingY + (innerH / gridLines) * i;
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", paddingLeft.toString());
    line.setAttribute("x2", (width - paddingRight).toString());
    line.setAttribute("y1", y.toString());
    line.setAttribute("y2", y.toString());
    line.setAttribute("stroke", "rgba(255,255,255,0.1)");
    line.setAttribute("stroke-width", "0.3");
    svg.appendChild(line);
  }

  const verticalGridPositions = [
    0,
    Math.floor(times.length / 2),
    times.length - 1,
  ];
  verticalGridPositions.forEach((idx) => {
    if (idx < 0 || idx >= times.length) return;
    const xNorm = (times[idx] - minX) / (maxX - minX);
    const x = paddingLeft + xNorm * innerW;
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", x.toString());
    line.setAttribute("x2", x.toString());
    line.setAttribute("y1", paddingY.toString());
    line.setAttribute("y2", (height - paddingBottom).toString());
    line.setAttribute("stroke", "rgba(255,255,255,0.1)");
    line.setAttribute("stroke-width", "0.3");
    svg.appendChild(line);
  });

  let overallMin: number;
  let overallMax: number;
  let overallLogMin: number;
  let overallLogMax: number;
  let overallLogRange: number;

  if (useLogarithmic) {
    overallMin = Math.min(...metricRanges.map((r) => r.min));
    overallMax = Math.max(...metricRanges.map((r) => r.max));
    overallLogMin = Math.log10(Math.max(overallMin, 0.001));
    overallLogMax = Math.log10(overallMax);
    overallLogRange = overallLogMax - overallLogMin;
    for (let i = 0; i <= gridLines; i++) {
      const y = paddingY + (innerH / gridLines) * i;
      const logPos = overallLogMax - (i / gridLines) * overallLogRange;
      const value = Math.pow(10, logPos);
      let label: string;
      if (value >= 1000) label = `${(value / 1000).toFixed(1)}k`;
      else if (value >= 1) label = value.toFixed(1);
      else label = value.toFixed(3);
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", (paddingLeft - 4).toString());
      text.setAttribute("y", (y + 1.5).toString());
      text.setAttribute("text-anchor", "end");
      text.setAttribute("fill", "rgba(255,255,255,0.5)");
      text.setAttribute("font-size", "2.2");
      text.textContent = label;
      svg.appendChild(text);
    }
  } else {
    overallMin = 0;
    overallMax = 1;
    overallLogMin = 0;
    overallLogMax = 1;
    overallLogRange = 1;
    for (let i = 0; i <= gridLines; i++) {
      const y = paddingY + (innerH / gridLines) * i;
      const percent = 100 - (i / gridLines) * 100;
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", (paddingLeft - 4).toString());
      text.setAttribute("y", (y + 1.5).toString());
      text.setAttribute("text-anchor", "end");
      text.setAttribute("fill", "rgba(255,255,255,0.5)");
      text.setAttribute("font-size", "2.2");
      text.textContent = `${Math.round(percent)}%`;
      svg.appendChild(text);
    }
  }

  const combTickY1 = height - paddingBottom;
  const combTickY2 = height - paddingBottom + 4;
  const combLabelY = height - paddingBottom + 6;
  let prevLabelDate: Date | null = null;
  if (chartRange === "30d") {
    const minDate = new Date(minX);
    let monday = new Date(
      minDate.getFullYear(),
      minDate.getMonth(),
      minDate.getDate(),
      0,
      0,
      0,
      0
    );
    const startDay = monday.getDay();
    const daysToMonday =
      startDay === 0 ? 1 : startDay === 1 ? 0 : 8 - startDay;
    monday.setDate(monday.getDate() + daysToMonday);
    while (monday.getTime() <= maxX) {
      const xNorm = (monday.getTime() - minX) / (maxX - minX);
      if (xNorm >= 0 && xNorm <= 1) {
        const x = paddingLeft + xNorm * innerW;
        const label = formatChartXLabel(monday, chartRange, null);
        if (label) {
          const tick = document.createElementNS(svgNS, "line");
          tick.setAttribute("x1", x.toString());
          tick.setAttribute("y1", combTickY1.toString());
          tick.setAttribute("x2", x.toString());
          tick.setAttribute("y2", combTickY2.toString());
          tick.setAttribute("stroke", "rgba(255,255,255,0.5)");
          tick.setAttribute("stroke-width", "0.4");
          svg.appendChild(tick);
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", x.toString());
          text.setAttribute("y", combLabelY.toString());
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("fill", "rgba(255,255,255,0.5)");
          text.setAttribute("font-size", "2.2");
          text.textContent = label;
          svg.appendChild(text);
        }
      }
      monday.setDate(monday.getDate() + 7);
    }
  } else {
    const labelCount = chartRange === "24h" ? 6 : 7;
    const step = Math.max(1, Math.floor(times.length / labelCount));
    for (let idx = 0; idx < times.length; idx += step) {
      if (idx >= times.length) break;
      const xNorm = (times[idx] - minX) / (maxX - minX);
      const x = paddingLeft + xNorm * innerW;
      const date = new Date(times[idx]);
      const label = formatChartXLabel(date, chartRange, prevLabelDate);
      if (chartRange === "24h" || chartRange === "7d") prevLabelDate = date;
      const tick = document.createElementNS(svgNS, "line");
      tick.setAttribute("x1", x.toString());
      tick.setAttribute("y1", combTickY1.toString());
      tick.setAttribute("x2", x.toString());
      tick.setAttribute("y2", combTickY2.toString());
      tick.setAttribute("stroke", "rgba(255,255,255,0.5)");
      tick.setAttribute("stroke-width", "0.4");
      svg.appendChild(tick);
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", x.toString());
      text.setAttribute("y", combLabelY.toString());
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", "rgba(255,255,255,0.5)");
      text.setAttribute("font-size", "2.2");
      text.textContent = label;
      svg.appendChild(text);
    }
  }

  metrics.forEach((metric, metricIdx) => {
    const range = metricRanges[metricIdx];
    const coords: { x: number; y: number }[] = [];
    for (let i = 0; i < times.length; i++) {
      const xNorm = (times[i] - minX) / (maxX - minX);
      const x = paddingLeft + xNorm * innerW;
      let yNorm: number;
      if (useLogarithmic) {
        const safeValue = Math.max(metric.values[i], 0.001);
        const overallLogValue = Math.log10(safeValue);
        yNorm =
          overallLogRange > 0
            ? (overallLogValue - overallLogMin) / overallLogRange
            : 0.5;
      } else {
        yNorm =
          range.range > 0
            ? (metric.values[i] - range.min) / range.range
            : 0.5;
      }
      const y = paddingY + innerH - yNorm * innerH;
      coords.push({ x, y });
    }

    const avgValue =
      metric.values.reduce((sum, v) => sum + v, 0) / metric.values.length;
    if (Number.isFinite(avgValue)) {
      let avgYNorm: number;
      if (useLogarithmic) {
        if (avgValue <= 0) return;
        const safeAvg = Math.max(avgValue, 0.001);
        const logAvg = Math.log10(safeAvg);
        avgYNorm =
          overallLogRange > 0
            ? (logAvg - overallLogMin) / overallLogRange
            : 0.5;
      } else {
        avgYNorm =
          range.range > 0 ? (avgValue - range.min) / range.range : 0.5;
        if (avgYNorm < 0 || avgYNorm > 1) return;
      }
      const avgY = paddingY + innerH - avgYNorm * innerH;
      const avgLine = document.createElementNS(svgNS, "line");
      avgLine.setAttribute("x1", paddingLeft.toString());
      avgLine.setAttribute("x2", (width - paddingRight).toString());
      avgLine.setAttribute("y1", avgY.toString());
      avgLine.setAttribute("y2", avgY.toString());
      avgLine.setAttribute("stroke", metric.color);
      avgLine.setAttribute("stroke-width", "0.6");
      avgLine.setAttribute("stroke-dasharray", "2,2");
      avgLine.setAttribute("opacity", "0.6");
      avgLine.style.cursor = "pointer";
      avgLine.addEventListener("mouseenter", (e) => {
        const svgRect = svg.getBoundingClientRect();
        const scaleY = svgRect.height / height;
        const mouseX = (e as MouseEvent).clientX;
        const y = svgRect.top + avgY * scaleY;
        tooltip.innerHTML = `
          <div style="font-weight: 600; margin-bottom: 2px;">Average ${metric.name}</div>
          <div>${formatNumber(avgValue, 2)} ${metric.unit}</div>
          <div style="color: var(--muted, #B0B0B0); font-size: 10px; margin-top: 2px;">Based on ${drawRows.length} measurement${drawRows.length !== 1 ? "s" : ""}</div>`;
        tooltip.style.display = "block";
        const tr = tooltip.getBoundingClientRect();
        tooltip.style.left = `${mouseX - tr.width / 2}px`;
        tooltip.style.top = `${y - tr.height - 5}px`;
      });
      avgLine.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
      svg.appendChild(avgLine);
    }

    if (coords.length > 1) {
      const path = document.createElementNS(svgNS, "path");
      let pathData = `M ${coords[0].x} ${coords[0].y}`;
      for (let i = 1; i < coords.length; i++) {
        pathData += ` L ${coords[i].x} ${coords[i].y}`;
      }
      path.setAttribute("d", pathData);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", metric.color);
      path.setAttribute("stroke-width", "0.8");
      path.setAttribute("opacity", "0.8");
      svg.appendChild(path);
    }

    coords.forEach((coord, index) => {
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", coord.x.toString());
      circle.setAttribute("cy", coord.y.toString());
      circle.setAttribute("r", "1.2");
      circle.setAttribute("fill", metric.color);
      circle.style.cursor = "pointer";
      const row = drawRows[index];
      const value = metric.values[index];
      const date = new Date(row.timestamp);
      circle.addEventListener("mouseenter", () => {
        circle.setAttribute("r", "1.4");
        circle.setAttribute("stroke", "#ffd700");
        circle.setAttribute("stroke-width", "0.5");
        tooltip.innerHTML = `
          <div style="font-weight: 600; margin-bottom: 2px;">${metric.name}</div>
          <div>${formatNumber(value, 2)} ${metric.unit}</div>
          <div style="color: var(--muted, #B0B0B0); font-size: 10px; margin-top: 2px;">${formatDateTime(date)}</div>`;
        tooltip.style.display = "block";
        const svgRect = svg.getBoundingClientRect();
        const scaleX = svgRect.width / width;
        const scaleY = svgRect.height / height;
        const x = svgRect.left + coord.x * scaleX;
        const y = svgRect.top + coord.y * scaleY;
        const tr = tooltip.getBoundingClientRect();
        tooltip.style.left = `${x - tr.width / 2}px`;
        tooltip.style.top = `${y - tr.height - 5}px`;
      });
      circle.addEventListener("mouseleave", () => {
        circle.setAttribute("r", "1.2");
        circle.removeAttribute("stroke");
        circle.removeAttribute("stroke-width");
        tooltip.style.display = "none";
      });
      svg.appendChild(circle);
    });
  });

  const legendY = height - paddingBottom + 4;
  let legendX = paddingLeft;
  metrics.forEach((metric) => {
    const g = document.createElementNS(svgNS, "g");
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", legendX.toString());
    circle.setAttribute("cy", legendY.toString());
    circle.setAttribute("r", "1.5");
    circle.setAttribute("fill", metric.color);
    g.appendChild(circle);
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", (legendX + 4).toString());
    text.setAttribute("y", (legendY + 1).toString());
    text.setAttribute("fill", "rgba(255,255,255,0.7)");
    text.setAttribute("font-size", "2.5");
    text.textContent = metric.name;
    g.appendChild(text);
    svg.appendChild(g);
    legendX += metric.name.length * 3.5 + 8;
  });

  containerEl.appendChild(svg);
  if (usePan && opts.onPanChange && pan) {
    setupChartPan(containerEl, pan, opts.onPanChange);
  }
}

/** Speedplane default series */
export const SPEEDPLANE_COMBINED_SERIES: SeriesDef[] = [
  { key: "download_mbps", name: "Download", unit: "Mbps", color: "#4ade80" },
  { key: "upload_mbps", name: "Upload", unit: "Mbps", color: "#60a5fa" },
  { key: "ping_ms", name: "Ping", unit: "ms", color: "#fbbf24" },
  { key: "jitter_ms", name: "Jitter", unit: "ms", color: "#f87171" },
];
