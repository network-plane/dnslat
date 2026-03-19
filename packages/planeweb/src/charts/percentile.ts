import { formatNumber } from "../format.js";
import type { PercentileStats } from "../types.js";

export function renderPercentileChart(
  container: HTMLElement | string,
  stats: PercentileStats,
  metricName: string,
  metricUnit: string
): void {
  const containerEl =
    typeof container === "string"
      ? document.getElementById(container)
      : container;
  if (!containerEl) throw new Error("renderPercentileChart: missing container");
  const prevPan = (containerEl as HTMLElement & { __panAbort?: AbortController })
    .__panAbort;
  if (prevPan) prevPan.abort();
  containerEl.innerHTML = "";
  containerEl.title = "";
  containerEl.style.cursor = "";

  let minY = Math.min(stats.min, stats.p10);
  let maxY = Math.max(stats.max, stats.p90);
  if (minY === maxY) {
    const delta = minY === 0 ? 1 : minY * 0.1;
    minY -= delta;
    maxY += delta;
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

  const innerW = width - paddingX * 2;
  const innerH = height - paddingY - paddingBottom;

  const yAt = (val: number): number => {
    const yNorm = maxY === minY ? 0.5 : (val - minY) / (maxY - minY);
    return paddingY + innerH - yNorm * innerH;
  };

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

  const centerX = width / 2;
  const boxWidth = innerW * 0.4;
  const whiskerCapWidth = 6;
  const boxY1 = yAt(stats.q3);
  const boxY2 = yAt(stats.q1);
  const box = document.createElementNS(svgNS, "rect");
  box.setAttribute("x", (centerX - boxWidth / 2).toString());
  box.setAttribute("y", boxY1.toString());
  box.setAttribute("width", boxWidth.toString());
  box.setAttribute("height", (boxY2 - boxY1).toString());
  box.setAttribute("fill", "#ffb341");
  box.setAttribute("stroke", "rgba(255,179,65,0.8)");
  box.setAttribute("stroke-width", "0.3");
  svg.appendChild(box);

  const medianY = yAt(stats.median);
  const medianLine = document.createElementNS(svgNS, "line");
  medianLine.setAttribute("x1", (centerX - boxWidth / 2).toString());
  medianLine.setAttribute("x2", (centerX + boxWidth / 2).toString());
  medianLine.setAttribute("y1", medianY.toString());
  medianLine.setAttribute("y2", medianY.toString());
  medianLine.setAttribute("stroke", "#ff8c00");
  medianLine.setAttribute("stroke-width", "1.2");
  svg.appendChild(medianLine);

  const upperWhiskerY = yAt(stats.max);
  const upperWhisker = document.createElementNS(svgNS, "line");
  upperWhisker.setAttribute("x1", centerX.toString());
  upperWhisker.setAttribute("x2", centerX.toString());
  upperWhisker.setAttribute("y1", boxY1.toString());
  upperWhisker.setAttribute("y2", upperWhiskerY.toString());
  upperWhisker.setAttribute("stroke", "rgba(255,255,255,0.4)");
  upperWhisker.setAttribute("stroke-width", "0.4");
  svg.appendChild(upperWhisker);
  const upperCap = document.createElementNS(svgNS, "line");
  upperCap.setAttribute("x1", (centerX - whiskerCapWidth / 2).toString());
  upperCap.setAttribute("x2", (centerX + whiskerCapWidth / 2).toString());
  upperCap.setAttribute("y1", upperWhiskerY.toString());
  upperCap.setAttribute("y2", upperWhiskerY.toString());
  upperCap.setAttribute("stroke", "rgba(255,255,255,0.4)");
  upperCap.setAttribute("stroke-width", "0.4");
  svg.appendChild(upperCap);

  const lowerWhiskerY = yAt(stats.min);
  const lowerWhisker = document.createElementNS(svgNS, "line");
  lowerWhisker.setAttribute("x1", centerX.toString());
  lowerWhisker.setAttribute("x2", centerX.toString());
  lowerWhisker.setAttribute("y1", boxY2.toString());
  lowerWhisker.setAttribute("y2", lowerWhiskerY.toString());
  lowerWhisker.setAttribute("stroke", "rgba(255,255,255,0.4)");
  lowerWhisker.setAttribute("stroke-width", "0.4");
  svg.appendChild(lowerWhisker);
  const lowerCap = document.createElementNS(svgNS, "line");
  lowerCap.setAttribute("x1", (centerX - whiskerCapWidth / 2).toString());
  lowerCap.setAttribute("x2", (centerX + whiskerCapWidth / 2).toString());
  lowerCap.setAttribute("y1", lowerWhiskerY.toString());
  lowerCap.setAttribute("y2", lowerWhiskerY.toString());
  lowerCap.setAttribute("stroke", "rgba(255,255,255,0.4)");
  lowerCap.setAttribute("stroke-width", "0.4");
  svg.appendChild(lowerCap);

  const statsText = document.createElementNS(svgNS, "text");
  statsText.setAttribute("x", centerX.toString());
  statsText.setAttribute("y", (height - paddingBottom + 6).toString());
  statsText.setAttribute("text-anchor", "middle");
  statsText.setAttribute("fill", "rgba(255,255,255,0.5)");
  statsText.setAttribute("font-size", "2.2");
  statsText.textContent = `Med: ${formatNumber(stats.median, 1)} | Q1: ${formatNumber(stats.q1, 1)} | Q3: ${formatNumber(stats.q3, 1)} ${metricUnit ? metricUnit : ""}`;
  svg.appendChild(statsText);

  containerEl.appendChild(svg);
}
