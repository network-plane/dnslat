import { formatNumber, formatChartXLabel, formatDateTime } from "../format.js";
import { getOrCreateChartTooltip } from "./tooltip.js";
import { setupChartPan, sliceRowsForPan, MIN_POINTS_FOR_PAN } from "./pan.js";
import type { TimeSeriesRow, RangeKey, ChartPanState } from "../types.js";

export type LineChartOptions = {
  range?: RangeKey;
  pan?: ChartPanState;
  onPanChange?: () => void;
  skipPanSetup?: boolean;
  /** default #ffb341 */
  strokeColor?: string;
  metricName: string;
  metricUnit: string;
};

function rowValue(row: TimeSeriesRow, key: string): number {
  const v = row.values[key];
  return v != null && Number.isFinite(v) ? v : 0;
}

export function renderLineChart(
  container: HTMLElement | string,
  rows: TimeSeriesRow[],
  valueKey: string,
  opts: LineChartOptions
): void {
  const containerEl =
    typeof container === "string"
      ? document.getElementById(container)
      : container;
  if (!containerEl) throw new Error("renderLineChart: missing container");
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
  const range = opts.range ?? "24h";
  const stroke = opts.strokeColor ?? "rgba(255,179,65,0.9)";

  if (!drawRows.length) {
    containerEl.textContent = "No data for selected range.";
    return;
  }

  const svgNS = "http://www.w3.org/2000/svg";
  const width = 300;
  const height = 50;
  const paddingX = 12;
  const paddingY = 8;
  const paddingBottom = 12;

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.height = "100%";

  const times = drawRows.map((r) => new Date(r.timestamp).getTime());
  const values = drawRows.map((r) => rowValue(r, valueKey));

  const minX = Math.min(...times);
  const maxX = Math.max(...times);
  let minY = Math.min(...values);
  let maxY = Math.max(...values);

  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    containerEl.textContent = "No valid data.";
    return;
  }
  if (minY === maxY) {
    const delta = minY === 0 ? 1 : minY * 0.1;
    minY -= delta;
    maxY += delta;
  }

  const innerW = width - paddingX * 2;
  const innerH = height - paddingY - paddingBottom;
  const tooltip = getOrCreateChartTooltip();

  const gridLines = 3;
  for (let i = 0; i <= gridLines; i++) {
    const yPos = paddingY + (innerH / gridLines) * i;
    const grid = document.createElementNS(svgNS, "line");
    grid.setAttribute("x1", paddingX.toString());
    grid.setAttribute("x2", (width - paddingX).toString());
    grid.setAttribute("y1", yPos.toString());
    grid.setAttribute("y2", yPos.toString());
    grid.setAttribute("stroke", "rgba(255,255,255,0.08)");
    grid.setAttribute("stroke-width", "0.3");
    svg.appendChild(grid);
    const value = maxY - (maxY - minY) * (i / gridLines);
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", (paddingX - 2).toString());
    text.setAttribute("y", (yPos + 1.5).toString());
    text.setAttribute("text-anchor", "end");
    text.setAttribute("fill", "rgba(255,255,255,0.4)");
    text.setAttribute("font-size", "2.5");
    text.textContent = formatNumber(value, 1);
    svg.appendChild(text);
  }

  const coords = drawRows.map((r, i) => {
    const t = new Date(r.timestamp).getTime();
    const xNorm = maxX === minX ? 0 : (t - minX) / (maxX - minX);
    const v = values[i];
    const yNorm = maxY === minY ? 0.5 : (v - minY) / (maxY - minY);
    return {
      x: paddingX + xNorm * innerW,
      y: paddingY + innerH - yNorm * innerH,
      time: t,
    };
  });

  coords.forEach((coord) => {
    const vLine = document.createElementNS(svgNS, "line");
    vLine.setAttribute("x1", coord.x.toString());
    vLine.setAttribute("x2", coord.x.toString());
    vLine.setAttribute("y1", paddingY.toString());
    vLine.setAttribute("y2", (paddingY + innerH).toString());
    vLine.setAttribute("stroke", "rgba(255,255,255,0.06)");
    vLine.setAttribute("stroke-width", "0.2");
    svg.appendChild(vLine);
  });

  const avgValue = values.reduce((s, v) => s + v, 0) / values.length;
  if (Number.isFinite(avgValue) && avgValue >= minY && avgValue <= maxY) {
    const avgYNorm = (avgValue - minY) / (maxY - minY);
    const avgY = paddingY + innerH - avgYNorm * innerH;
    const avgLine = document.createElementNS(svgNS, "line");
    avgLine.setAttribute("x1", paddingX.toString());
    avgLine.setAttribute("x2", (width - paddingX).toString());
    avgLine.setAttribute("y1", avgY.toString());
    avgLine.setAttribute("y2", avgY.toString());
    avgLine.setAttribute("stroke", "#ff4757");
    avgLine.setAttribute("stroke-width", "0.6");
    avgLine.setAttribute("stroke-dasharray", "2,2");
    avgLine.setAttribute("opacity", "0.8");
    avgLine.style.cursor = "pointer";
    avgLine.addEventListener("mouseenter", (e) => {
      const svgRect = svg.getBoundingClientRect();
      const scaleY = svgRect.height / height;
      const mouseX = (e as MouseEvent).clientX;
      const y = svgRect.top + avgY * scaleY;
      tooltip.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 2px;">Average ${opts.metricName}</div>
        <div>${formatNumber(avgValue, 2)} ${opts.metricUnit}</div>
        <div style="color: var(--muted, #B0B0B0); font-size: 10px; margin-top: 2px;">Based on ${drawRows.length} measurement${drawRows.length !== 1 ? "s" : ""}</div>`;
      tooltip.style.display = "block";
      const tr = tooltip.getBoundingClientRect();
      tooltip.style.left = `${mouseX - tr.width / 2}px`;
      tooltip.style.top = `${y - tr.height - 8}px`;
    });
    avgLine.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });
    svg.appendChild(avgLine);
  }

  const path = document.createElementNS(svgNS, "path");
  path.setAttribute(
    "d",
    coords.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", stroke);
  path.setAttribute("stroke-width", "0.8");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-linecap", "round");
  svg.appendChild(path);

  coords.forEach((coord, index) => {
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", coord.x.toString());
    circle.setAttribute("cy", coord.y.toString());
    circle.setAttribute("r", "1.2");
    circle.setAttribute("fill", "#ffb341");
    circle.style.cursor = "pointer";
    const row = drawRows[index];
    const value = values[index];
    const date = new Date(row.timestamp);
    circle.addEventListener("mouseenter", () => {
      circle.setAttribute("r", "1.4");
      circle.setAttribute("stroke", "#ffd700");
      circle.setAttribute("stroke-width", "0.5");
      tooltip.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 2px;">${opts.metricName}</div>
        <div>${formatNumber(value, 2)} ${opts.metricUnit}</div>
        <div style="color: var(--muted, #B0B0B0); font-size: 10px; margin-top: 2px;">${formatDateTime(date)}</div>`;
      tooltip.style.display = "block";
      const svgRect = svg.getBoundingClientRect();
      const scaleX = svgRect.width / width;
      const scaleY = svgRect.height / height;
      const x = svgRect.left + coord.x * scaleX;
      const y = svgRect.top + coord.y * scaleY;
      const tr = tooltip.getBoundingClientRect();
      tooltip.style.left = `${x - tr.width / 2}px`;
      tooltip.style.top = `${y - tr.height - 8}px`;
    });
    circle.addEventListener("mouseleave", () => {
      circle.setAttribute("r", "1.2");
      circle.setAttribute("fill", "#ffb341");
      circle.removeAttribute("stroke");
      circle.removeAttribute("stroke-width");
      tooltip.style.display = "none";
    });
    svg.appendChild(circle);
  });

  const tickY1 = height - paddingBottom;
  const tickY2 = height - paddingBottom + 4;
  const labelY = height - paddingBottom + 8;
  let previousLabelDate: Date | null = null;
  if (range === "30d") {
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
        const x = paddingX + xNorm * innerW;
        const label = formatChartXLabel(monday, range, null);
        if (label) {
          const tick = document.createElementNS(svgNS, "line");
          tick.setAttribute("x1", x.toString());
          tick.setAttribute("y1", tickY1.toString());
          tick.setAttribute("x2", x.toString());
          tick.setAttribute("y2", tickY2.toString());
          tick.setAttribute("stroke", "rgba(255,255,255,0.4)");
          tick.setAttribute("stroke-width", "0.4");
          svg.appendChild(tick);
          const text = document.createElementNS(svgNS, "text");
          text.setAttribute("x", x.toString());
          text.setAttribute("y", labelY.toString());
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("fill", "rgba(255,255,255,0.4)");
          text.setAttribute("font-size", "2.5");
          text.textContent = label;
          svg.appendChild(text);
        }
      }
      monday.setDate(monday.getDate() + 7);
    }
  } else {
    const labelCount =
      range === "24h" ? Math.min(drawRows.length, 6) : Math.min(drawRows.length, 7);
    const labelStep = Math.max(1, Math.floor(drawRows.length / labelCount));
    for (let i = 0; i < drawRows.length; i += labelStep) {
      if (i >= coords.length) break;
      const coord = coords[i];
      const date = new Date(drawRows[i].timestamp);
      const timeStr = formatChartXLabel(date, range, previousLabelDate);
      if (range === "24h" || range === "7d") previousLabelDate = date;
      const tick = document.createElementNS(svgNS, "line");
      tick.setAttribute("x1", coord.x.toString());
      tick.setAttribute("y1", tickY1.toString());
      tick.setAttribute("x2", coord.x.toString());
      tick.setAttribute("y2", tickY2.toString());
      tick.setAttribute("stroke", "rgba(255,255,255,0.4)");
      tick.setAttribute("stroke-width", "0.4");
      svg.appendChild(tick);
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", coord.x.toString());
      text.setAttribute("y", labelY.toString());
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", "rgba(255,255,255,0.4)");
      text.setAttribute("font-size", "2.5");
      text.textContent = timeStr;
      svg.appendChild(text);
    }
  }

  containerEl.appendChild(svg);
  if (usePan && opts.onPanChange && pan) {
    setupChartPan(containerEl, pan, opts.onPanChange);
  }
}
