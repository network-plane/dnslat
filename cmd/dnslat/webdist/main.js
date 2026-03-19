(() => {
  // packages/planeweb/src/format.ts
  function formatNumber(val2, digits = 2) {
    if (val2 == null || Number.isNaN(val2)) return "\u2013";
    return val2.toFixed(digits);
  }
  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  function formatTime24h(date) {
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${min}`;
  }
  function formatDateTime(date) {
    return `${formatDate(date)} ${formatTime24h(date)}`;
  }
  function formatChartXLabel(date, range, previousLabelDate) {
    if (range === "24h") {
      const showDate = !previousLabelDate || date.getDate() !== previousLabelDate.getDate() || date.getMonth() !== previousLabelDate.getMonth();
      if (showDate) return `${formatDate(date)} ${formatTime24h(date)}`;
      return formatTime24h(date);
    }
    if (range === "7d") return formatDate(date);
    if (range === "30d") return date.getDay() === 1 ? formatDate(date) : "";
    return formatTime24h(date);
  }

  // packages/planeweb/src/http.ts
  async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers || {}
      }
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return await res.json();
  }

  // packages/planeweb/src/charts/tooltip.ts
  var CHART_TOOLTIP_CLASS = "chart-tooltip";
  var sharedChartTooltip = null;
  function getOrCreateChartTooltip() {
    if (sharedChartTooltip && sharedChartTooltip.parentNode) {
      sharedChartTooltip.style.display = "none";
      return sharedChartTooltip;
    }
    sharedChartTooltip = document.createElement("div");
    sharedChartTooltip.className = CHART_TOOLTIP_CLASS;
    sharedChartTooltip.style.cssText = `
    position: fixed;
    background: rgba(26, 26, 26, 0.95);
    border: 1px solid var(--border, rgba(255,140,0,.25));
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 11px;
    color: var(--txt, #E8E8E8);
    pointer-events: none;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    display: none;
    white-space: nowrap;
  `;
    document.body.appendChild(sharedChartTooltip);
    return sharedChartTooltip;
  }
  function hideChartTooltip() {
    if (sharedChartTooltip) sharedChartTooltip.style.display = "none";
  }

  // packages/planeweb/src/charts/pan.ts
  var MIN_POINTS_FOR_PAN = 10;
  function sliceRowsForPan(rows, pan) {
    if (rows.length <= MIN_POINTS_FOR_PAN) return rows;
    const visibleCount = Math.max(
      1,
      Math.min(rows.length, Math.ceil(rows.length * pan.windowFraction))
    );
    const maxStart = Math.max(0, rows.length - visibleCount);
    const startIndex = Math.min(maxStart, Math.round(pan.offset * maxStart));
    return rows.slice(startIndex, startIndex + visibleCount);
  }
  function setupChartPan(container, pan, onPanChange) {
    const prev = container.__panAbort;
    if (prev) prev.abort();
    const controller = new AbortController();
    container.__panAbort = controller;
    const { signal } = controller;
    let dragging = false;
    let startClientX = 0;
    let startOffset = 0;
    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      hideChartTooltip();
      dragging = true;
      startClientX = e.clientX;
      startOffset = pan.offset;
      container.style.cursor = "grabbing";
      e.preventDefault();
    };
    const onMouseMove = (e) => {
      if (!dragging) return;
      const chartWidth = container.clientWidth || 300;
      const deltaX = e.clientX - startClientX;
      const offsetDelta = deltaX / chartWidth;
      pan.offset = Math.max(0, Math.min(1, startOffset + offsetDelta));
      startClientX = e.clientX;
      startOffset = pan.offset;
      onPanChange();
    };
    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      container.style.cursor = "grab";
    };
    container.addEventListener("mousedown", onMouseDown, {
      signal
    });
    container.addEventListener(
      "mouseenter",
      () => {
        if (!dragging) container.style.cursor = "grab";
      },
      { signal }
    );
    container.addEventListener(
      "mouseleave",
      () => {
        container.style.cursor = "";
        onMouseUp();
      },
      { signal }
    );
    document.addEventListener("mousemove", onMouseMove, { signal });
    document.addEventListener("mouseup", onMouseUp, { signal });
    container.style.cursor = "grab";
    container.title = "Drag to pan";
  }

  // packages/planeweb/src/charts/line.ts
  function rowValue(row, key) {
    const v = row.values[key];
    return v != null && Number.isFinite(v) ? v : 0;
  }
  function renderLineChart(container, rows, valueKey, opts) {
    const containerEl = typeof container === "string" ? document.getElementById(container) : container;
    if (!containerEl) throw new Error("renderLineChart: missing container");
    containerEl.innerHTML = "";
    const pan = opts.pan;
    const usePan = pan && rows.length >= MIN_POINTS_FOR_PAN && opts.onPanChange && !opts.skipPanSetup;
    const usePanSlice = pan && rows.length >= MIN_POINTS_FOR_PAN && opts.onPanChange;
    const drawRows = usePanSlice ? sliceRowsForPan(rows, pan) : rows;
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
      const yPos = paddingY + innerH / gridLines * i;
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
        time: t
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
        const mouseX = e.clientX;
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
    let previousLabelDate = null;
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
      const daysToMonday = startDay === 0 ? 1 : startDay === 1 ? 0 : 8 - startDay;
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
      const labelCount = range === "24h" ? Math.min(drawRows.length, 6) : Math.min(drawRows.length, 7);
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

  // packages/planeweb/src/charts/combined.ts
  function val(row, key) {
    const v = row.values[key];
    return v != null && Number.isFinite(v) ? v : 0;
  }
  function renderCombinedChart(container, rows, series, opts = {}) {
    const containerEl = typeof container === "string" ? document.getElementById(container) : container;
    if (!containerEl) throw new Error("renderCombinedChart: missing container");
    containerEl.innerHTML = "";
    const pan = opts.pan;
    const usePan = pan && rows.length >= MIN_POINTS_FOR_PAN && opts.onPanChange && !opts.skipPanSetup;
    const usePanSlice = pan && rows.length >= MIN_POINTS_FOR_PAN && opts.onPanChange;
    const drawRows = usePanSlice ? sliceRowsForPan(rows, pan) : rows;
    const chartRange = opts.range ?? "24h";
    const useLogarithmic = opts.useLogarithmic ?? (typeof localStorage !== "undefined" && localStorage.getItem("logarithmic-scale") === "true");
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
      values: drawRows.map((r) => val(r, s.key))
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
            range: 1
          };
        }
        return { min: 0, max: 1, range: 1 };
      }
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const range = max - min || 1;
      if (useLogarithmic) {
        const safeMin = Math.max(min, 1e-3);
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
      const y = paddingY + innerH / gridLines * i;
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
      times.length - 1
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
    let overallMin;
    let overallMax;
    let overallLogMin;
    let overallLogMax;
    let overallLogRange;
    if (useLogarithmic) {
      overallMin = Math.min(...metricRanges.map((r) => r.min));
      overallMax = Math.max(...metricRanges.map((r) => r.max));
      overallLogMin = Math.log10(Math.max(overallMin, 1e-3));
      overallLogMax = Math.log10(overallMax);
      overallLogRange = overallLogMax - overallLogMin;
      for (let i = 0; i <= gridLines; i++) {
        const y = paddingY + innerH / gridLines * i;
        const logPos = overallLogMax - i / gridLines * overallLogRange;
        const value = Math.pow(10, logPos);
        let label;
        if (value >= 1e3) label = `${(value / 1e3).toFixed(1)}k`;
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
        const y = paddingY + innerH / gridLines * i;
        const percent = 100 - i / gridLines * 100;
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
    let prevLabelDate = null;
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
      const daysToMonday = startDay === 0 ? 1 : startDay === 1 ? 0 : 8 - startDay;
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
      const coords = [];
      for (let i = 0; i < times.length; i++) {
        const xNorm = (times[i] - minX) / (maxX - minX);
        const x = paddingLeft + xNorm * innerW;
        let yNorm;
        if (useLogarithmic) {
          const safeValue = Math.max(metric.values[i], 1e-3);
          const overallLogValue = Math.log10(safeValue);
          yNorm = overallLogRange > 0 ? (overallLogValue - overallLogMin) / overallLogRange : 0.5;
        } else {
          yNorm = range.range > 0 ? (metric.values[i] - range.min) / range.range : 0.5;
        }
        const y = paddingY + innerH - yNorm * innerH;
        coords.push({ x, y });
      }
      const avgValue = metric.values.reduce((sum, v) => sum + v, 0) / metric.values.length;
      if (Number.isFinite(avgValue)) {
        let avgYNorm;
        if (useLogarithmic) {
          if (avgValue <= 0) return;
          const safeAvg = Math.max(avgValue, 1e-3);
          const logAvg = Math.log10(safeAvg);
          avgYNorm = overallLogRange > 0 ? (logAvg - overallLogMin) / overallLogRange : 0.5;
        } else {
          avgYNorm = range.range > 0 ? (avgValue - range.min) / range.range : 0.5;
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
          const mouseX = e.clientX;
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

  // packages/planeweb/src/charts/percentile.ts
  function renderPercentileChart(container, stats, metricName, metricUnit) {
    const containerEl = typeof container === "string" ? document.getElementById(container) : container;
    if (!containerEl) throw new Error("renderPercentileChart: missing container");
    const prevPan = containerEl.__panAbort;
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
    const yAt = (val2) => {
      const yNorm = maxY === minY ? 0.5 : (val2 - minY) / (maxY - minY);
      return paddingY + innerH - yNorm * innerH;
    };
    const gridLines = 3;
    for (let i = 0; i <= gridLines; i++) {
      const yPos = paddingY + innerH / gridLines * i;
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

  // web/dnslat/src/main.ts
  function resolversToProbe(list) {
    return list.filter((r) => r.enabled);
  }
  var COLORS = ["#4ade80", "#60a5fa", "#fbbf24", "#f87171", "#a78bfa", "#2dd4bf", "#fb7185", "#38bdf8"];
  function $(id) {
    const e = document.getElementById(id);
    if (!e) throw new Error("#" + id);
    return e;
  }
  function showConfirm(title, message, okLabel = "OK", danger = false) {
    return new Promise((resolve) => {
      const overlay = $("confirm-modal");
      $("confirm-modal-title").textContent = title;
      $("confirm-modal-message").textContent = message;
      const okBtn = $("confirm-modal-ok");
      const cancelBtn = $("confirm-modal-cancel");
      okBtn.textContent = okLabel;
      okBtn.classList.toggle("btn-danger", danger);
      overlay.style.display = "flex";
      const done = (v) => {
        overlay.style.display = "none";
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        overlay.removeEventListener("click", onBackdrop);
        document.removeEventListener("keydown", onKey);
        resolve(v);
      };
      const onOk = () => done(true);
      const onCancel = () => done(false);
      const onBackdrop = (e) => {
        if (e.target === overlay) done(false);
      };
      const onKey = (e) => {
        if (e.key === "Escape") done(false);
      };
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      overlay.addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKey);
    });
  }
  function safeId(id) {
    return id.replace(/[^a-zA-Z0-9]/g, "_");
  }
  async function loadResolvers() {
    return fetchJSON("/api/resolvers");
  }
  function applyCombinedPanelVisibility() {
    const on = localStorage.getItem("combined-graph") === "true";
    $("combined-chart-panel").style.display = on ? "" : "none";
    $("individual-charts").style.display = on ? "none" : "";
  }
  async function refreshDashboardCards() {
    const dash = await fetchJSON("/api/dashboard-summary");
    $("card-domain").textContent = dash.query_domain || "\u2013";
    const hasFast = dash.fastest_name && dash.fastest_ms > 0;
    $("card-fastest-name").textContent = hasFast ? dash.fastest_name : "\u2013";
    $("card-fastest-ms").textContent = hasFast ? `${formatNumber(dash.fastest_ms, 1)} ms` : "\u2013";
    $("card-median").textContent = dash.median_all_ms > 0 ? `${formatNumber(dash.median_all_ms, 1)} ms` : "\u2013";
    const hasSlow = dash.slowest_name && dash.slowest_ms > 0;
    $("card-slowest-name").textContent = hasSlow ? dash.slowest_name : "\u2013";
    $("card-slowest-ms").textContent = hasSlow ? `${formatNumber(dash.slowest_ms, 1)} ms` : "\u2013";
    $("card-runs").textContent = String(dash.run_count_30d ?? 0);
    const avg = dash.avg_median_30d_ms;
    if (avg > 0 && dash.fastest_ms > 0) {
      const d = dash.fastest_ms - avg;
      $("card-fastest-compare").textContent = d <= 0 ? `${formatNumber(Math.abs(d), 1)} ms vs 30d avg` : `+${formatNumber(d, 1)} ms vs 30d avg`;
    } else $("card-fastest-compare").textContent = "";
    if (avg > 0 && dash.median_all_ms > 0) {
      const d = dash.median_all_ms - avg;
      $("card-median-compare").textContent = Math.abs(d) < 0.01 ? "On 30d avg" : d < 0 ? `${formatNumber(Math.abs(d), 1)} ms below 30d avg` : `${formatNumber(d, 1)} ms above 30d avg`;
    } else $("card-median-compare").textContent = "";
  }
  async function refreshCombinedChart() {
    if (localStorage.getItem("combined-graph") !== "true") return;
    const range = $("range-combined").value;
    const resolvers = resolversToProbe(await loadResolvers());
    const j = await fetchJSON(
      "/api/chart-combined?range=" + encodeURIComponent(range)
    );
    const series = resolvers.map((r, i) => ({
      key: r.id,
      name: r.name,
      unit: "ms",
      color: COLORS[i % COLORS.length]
    }));
    const el = $("combined-chart");
    if (!j.data.length) {
      el.textContent = "No data yet.";
      return;
    }
    renderCombinedChart("combined-chart", j.data, series, {
      range,
      useLogarithmic: localStorage.getItem("logarithmic-scale") === "true"
    });
  }
  async function renderResolverChart(resolver) {
    const cid = "chart-res-" + safeId(resolver.id);
    const range = document.getElementById("range-res-" + safeId(resolver.id))?.value;
    const toggle = document.getElementById("toggle-res-" + safeId(resolver.id));
    const pct = toggle?.classList.contains("active");
    if (!range) return;
    if (pct) {
      const cd = await fetchJSON(
        "/api/chart-data?range=" + encodeURIComponent(range) + "&metric=" + encodeURIComponent(resolver.id)
      );
      if (!cd.stats || !cd.data.length) {
        const box2 = document.getElementById(cid);
        if (box2) box2.textContent = "No data.";
        return;
      }
      renderPercentileChart(cid, cd.stats, resolver.name, "ms");
      return;
    }
    const j = await fetchJSON(
      "/api/chart-data?range=" + encodeURIComponent(range) + "&metric=" + encodeURIComponent(resolver.id)
    );
    const rows = (j.data || []).map((row) => ({
      timestamp: row.timestamp,
      values: { latency: row.values?.latency ?? 0 }
    }));
    const box = document.getElementById(cid);
    if (!rows.length) {
      if (box) box.textContent = "No data";
      return;
    }
    const idx = (await loadResolvers()).findIndex((r) => r.id === resolver.id);
    renderLineChart(cid, rows, "latency", {
      range,
      metricName: resolver.name,
      metricUnit: "ms",
      strokeColor: COLORS[(idx >= 0 ? idx : 0) % COLORS.length]
    });
  }
  async function buildIndividualChartPanels() {
    const grid = $("individual-charts");
    grid.innerHTML = "";
    const resolvers = resolversToProbe(await loadResolvers());
    if (!resolvers.length) {
      grid.innerHTML = "<p class='muted' style='padding:12px;'>No enabled resolvers. Enable at least one under Preferences.</p>";
      return;
    }
    for (let i = 0; i < resolvers.length; i++) {
      const r = resolvers[i];
      const sid = safeId(r.id);
      const pctOn = localStorage.getItem("chart-pct-" + r.id) === "true";
      const panel = document.createElement("div");
      panel.className = "panel";
      panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">${r.name} (ms)</div>
        <div style="display:flex;gap:12px;align-items:center;">
          <select id="range-res-${sid}" class="select">
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;color:var(--muted);">Percentile</span>
            <button type="button" class="chart-toggle${pctOn ? " active" : ""}" id="toggle-res-${sid}"><span class="chart-toggle-slider"></span></button>
          </div>
        </div>
      </div>
      <div class="chart" id="chart-res-${sid}"></div>`;
      grid.appendChild(panel);
      const sel = document.getElementById("range-res-" + sid);
      sel.addEventListener("change", () => renderResolverChart(r).catch(console.error));
      const tog = document.getElementById("toggle-res-" + sid);
      tog?.addEventListener("click", () => {
        tog.classList.toggle("active");
        localStorage.setItem("chart-pct-" + r.id, tog.classList.contains("active") ? "true" : "false");
        renderResolverChart(r).catch(console.error);
      });
      await renderResolverChart(r);
    }
  }
  var historyPage = 0;
  var historyPerPage = 100;
  var historyTotal = 0;
  var historySortCol = "timestamp";
  var historySortAsc = false;
  function defaultSortAscForColumn(col) {
    if (col === "query_domain") return true;
    if (col === "timestamp" || col === "id") return false;
    return true;
  }
  function renderHistoryThead(resolvers) {
    const tr = $("history-thead-row");
    tr.innerHTML = "";
    const headers = [
      { label: "ID", key: "id" },
      { label: "When", key: "timestamp" },
      { label: "Domain", key: "query_domain" },
      ...resolvers.map((r) => ({ label: r.name, key: r.id })),
      { label: "", key: null }
    ];
    for (const h of headers) {
      const th = document.createElement("th");
      if (h.key == null) {
        th.textContent = h.label;
        tr.appendChild(th);
        continue;
      }
      th.className = "history-sortable";
      th.title = "Sort by " + h.label;
      const label = document.createElement("span");
      label.textContent = h.label;
      th.appendChild(label);
      if (historySortCol === h.key) {
        const ind = document.createElement("span");
        ind.className = "history-sort-indicator";
        ind.textContent = historySortAsc ? " \u25B2" : " \u25BC";
        th.appendChild(ind);
      }
      th.addEventListener("click", () => {
        if (historySortCol === h.key) historySortAsc = !historySortAsc;
        else {
          historySortCol = h.key;
          historySortAsc = defaultSortAscForColumn(historySortCol);
        }
        historyPage = 0;
        loadHistoryPage().catch(console.error);
      });
      tr.appendChild(th);
    }
  }
  async function loadHistoryPage() {
    const resolvers = await loadResolvers();
    renderHistoryThead(resolvers);
    const off = historyPage * historyPerPage;
    const sortQ = encodeURIComponent(historySortCol);
    const dirQ = historySortAsc ? "asc" : "desc";
    const j = await fetchJSON(
      `/api/history?limit=${historyPerPage}&offset=${off}&sort=${sortQ}&dir=${dirQ}`
    );
    historyTotal = j.total;
    const tb = document.querySelector("#history-table tbody");
    tb.innerHTML = "";
    for (const run of j.results) {
      const tr = document.createElement("tr");
      const byId = {};
      for (const rr of run.results) byId[rr.resolver_id] = rr.latency_ms;
      const cells = [
        run.id.slice(0, 8) + "\u2026",
        formatDateTime(new Date(run.timestamp)),
        run.query_domain,
        ...resolvers.map((rv) => formatNumber(byId[rv.id] ?? 0, 2))
      ];
      cells.forEach((c) => {
        const td2 = document.createElement("td");
        td2.textContent = c;
        tr.appendChild(td2);
      });
      const td = document.createElement("td");
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Delete";
      btn.onclick = async () => {
        const ok = await showConfirm(
          "Delete run?",
          "Remove this probe run from the database. This cannot be undone.",
          "Delete",
          true
        );
        if (!ok) return;
        await fetch("/api/runs/" + encodeURIComponent(run.id), { method: "DELETE" });
        await loadHistoryPage();
        refreshDashboardCards().catch(console.error);
      };
      td.appendChild(btn);
      tr.appendChild(td);
      tb.appendChild(tr);
    }
    const pages = Math.max(1, Math.ceil(historyTotal / historyPerPage));
    historyPage = Math.min(historyPage, pages - 1);
    $("history-page-info").textContent = `Page ${historyPage + 1} of ${pages} (${historyTotal} runs)`;
  }
  async function refreshSchemes(template) {
    const sel = $("pref-scheme");
    sel.innerHTML = "";
    try {
      const schemes = await fetchJSON(
        "/api/schemes?template=" + encodeURIComponent(template)
      );
      for (const s of schemes) {
        const o = document.createElement("option");
        o.value = s.name;
        o.textContent = s.display || s.name;
        sel.appendChild(o);
      }
      const saved = localStorage.getItem("scheme") || "";
      if ([...sel.options].some((o) => o.value === saved)) sel.value = saved;
    } catch {
      sel.innerHTML = "<option value='default'>default</option>";
    }
  }
  function applyTheme(template, scheme) {
    localStorage.setItem("template", template);
    localStorage.setItem("scheme", scheme);
    document.documentElement.setAttribute("data-template", template);
    document.documentElement.setAttribute("data-scheme", scheme);
    fetch("/api/theme?template=" + encodeURIComponent(template) + "&scheme=" + encodeURIComponent(scheme)).then((r) => r.text()).then((css) => {
      const s = document.getElementById("theme-css");
      if (s) s.textContent = css;
    }).catch(console.error);
  }
  var scheduleTimerInterval = null;
  var nextRunTime = null;
  var intervalDurationMs = null;
  var intervalStartTime = null;
  async function fetchNextRunForTimer() {
    const timerEl = document.getElementById("schedule-timer");
    if (!timerEl) return;
    try {
      const data = await fetchJSON("/api/next-run");
      if (!data.next_run) {
        timerEl.style.display = "none";
        nextRunTime = null;
        intervalDurationMs = null;
        intervalStartTime = null;
        timerEl.textContent = "";
        return;
      }
      timerEl.style.display = "block";
      const nextRun = new Date(data.next_run).getTime();
      nextRunTime = nextRun;
      const ivSec = data.interval_duration > 0 ? data.interval_duration : 3600;
      intervalDurationMs = ivSec * 1e3;
      intervalStartTime = nextRun - intervalDurationMs;
      updateTimerDisplay();
    } catch {
      timerEl.style.display = "none";
    }
  }
  function updateTimerDisplay() {
    const timerEl = document.getElementById("schedule-timer");
    if (!timerEl || !nextRunTime || !intervalDurationMs || intervalStartTime == null) return;
    const now = Date.now();
    const remaining = Math.max(0, nextRunTime - now);
    const elapsed = now - intervalStartTime;
    const percent = Math.min(100, Math.max(0, elapsed / intervalDurationMs * 100));
    const totalSeconds = Math.ceil(remaining / 1e3);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor(totalSeconds % 86400 / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    const timeStr = parts.join(" ");
    timerEl.textContent = "";
    if (remaining > 0) {
      timerEl.title = `Next DNS run in ${timeStr}`;
      timerEl.classList.remove("paused");
      timerEl.style.setProperty("--progress-percent", percent + "%");
    } else {
      timerEl.title = "Ready (checking schedules\u2026)";
      timerEl.classList.add("paused");
      timerEl.style.setProperty("--progress-percent", "100%");
    }
  }
  function startScheduleTimer() {
    void fetchNextRunForTimer();
    if (scheduleTimerInterval) clearInterval(scheduleTimerInterval);
    let tick = 0;
    scheduleTimerInterval = window.setInterval(() => {
      updateTimerDisplay();
      tick++;
      if (tick % 30 === 0) void fetchNextRunForTimer();
    }, 1e3);
  }
  var editingScheduleId = null;
  async function loadSchedules() {
    const list = await fetchJSON("/api/schedules");
    const box = $("schedules-list");
    box.innerHTML = "";
    for (const sc of list) {
      const div = document.createElement("div");
      div.className = "form-row";
      div.style.marginBottom = "8px";
      const t = sc.type === "daily" ? `daily @ ${sc.time_of_day || "?"}` : `every ${sc.every || "?"}`;
      div.innerHTML = `<span style="flex:1">${sc.enabled ? "\u25CF" : "\u25CB"} <strong>${sc.name}</strong> \u2014 ${t}</span>`;
      const ed = document.createElement("button");
      ed.className = "btn";
      ed.textContent = "Edit";
      ed.onclick = () => {
        editingScheduleId = sc.id;
        $("schedule-form-id").value = sc.id;
        $("schedule-form-name").value = sc.name;
        $("schedule-form-type").value = sc.type;
        $("schedule-form-every").value = sc.every || "";
        $("schedule-form-timeOfDay").value = sc.time_of_day || "";
        $("schedule-form-enabled").checked = sc.enabled;
        $("schedule-form-submit").textContent = "Save";
        $("schedule-form-cancel").style.display = "";
        syncScheduleFields();
      };
      const del = document.createElement("button");
      del.className = "btn";
      del.textContent = "Delete";
      del.onclick = async () => {
        const ok = await showConfirm(
          "Delete schedule?",
          `Remove schedule "${sc.name || sc.id}"? This cannot be undone.`,
          "Delete",
          true
        );
        if (!ok) return;
        await fetch("/api/schedules/" + encodeURIComponent(sc.id), { method: "DELETE" });
        await loadSchedules();
        void fetchNextRunForTimer();
      };
      div.appendChild(ed);
      div.appendChild(del);
      box.appendChild(div);
    }
  }
  function syncScheduleFields() {
    const t = $("schedule-form-type").value;
    $("schedule-form-every-field").style.display = t === "interval" ? "" : "none";
    $("schedule-form-timeOfDay-field").style.display = t === "daily" ? "" : "none";
  }
  function showView(name) {
    const titles = {
      dashboard: "Dashboard",
      history: "Results",
      preferences: "Preferences",
      about: "About"
    };
    $("subtitle").textContent = titles[name] || "";
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("view-active"));
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("nav-item-active"));
    const map = {
      dashboard: "view-dashboard",
      history: "view-history",
      preferences: "view-preferences",
      about: "view-about"
    };
    document.getElementById(map[name])?.classList.add("view-active");
    document.querySelector(`[data-view="${name}"]`)?.classList.add("nav-item-active");
    if (name === "history") loadHistoryPage().catch(console.error);
    if (name === "preferences") {
      loadSchedules().catch(console.error);
      loadResolvers().then(renderResolverList).catch(console.error);
    }
  }
  function renderResolverList(resolvers) {
    const ul = $("resolver-list");
    ul.innerHTML = "";
    for (const r of resolvers) {
      const li = document.createElement("li");
      li.style.marginBottom = "10px";
      li.style.display = "flex";
      li.style.alignItems = "center";
      li.style.flexWrap = "wrap";
      li.style.gap = "10px";
      const probe = document.createElement("label");
      probe.style.display = "inline-flex";
      probe.style.alignItems = "center";
      probe.style.gap = "6px";
      probe.style.cursor = "pointer";
      probe.style.fontSize = "12px";
      probe.style.color = "var(--muted)";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = r.enabled;
      cb.title = "When checked, this resolver is queried on each run";
      cb.addEventListener("change", async () => {
        const want = cb.checked;
        try {
          await fetchJSON("/api/resolvers/" + encodeURIComponent(r.id), {
            method: "PATCH",
            body: JSON.stringify({ enabled: want })
          });
        } catch {
          cb.checked = !want;
          return;
        }
        refreshAll().catch(console.error);
      });
      probe.appendChild(cb);
      probe.appendChild(document.createTextNode("Probe"));
      const info = document.createElement("span");
      info.style.flex = "1";
      info.style.minWidth = "200px";
      const strong = document.createElement("strong");
      strong.textContent = r.name;
      info.appendChild(strong);
      info.appendChild(document.createTextNode(" "));
      const addr = document.createElement("span");
      addr.className = "muted";
      addr.textContent = r.address;
      info.appendChild(addr);
      if (r.builtin) {
        const tag = document.createElement("span");
        tag.className = "muted";
        tag.style.fontSize = "11px";
        tag.textContent = " (default)";
        info.appendChild(tag);
      }
      const b = document.createElement("button");
      b.className = "btn";
      b.style.fontSize = "11px";
      b.textContent = "Remove";
      b.onclick = async () => {
        const ok = await showConfirm(
          "Remove resolver?",
          `Remove \u201C${r.name}\u201D (${r.address})? This cannot be undone.`,
          "Remove",
          true
        );
        if (!ok) return;
        const res = await fetch("/api/resolvers/" + encodeURIComponent(r.id), { method: "DELETE" });
        if (!res.ok) {
          alert("Could not remove resolver");
          return;
        }
        await renderResolverList(await loadResolvers());
        refreshAll().catch(console.error);
      };
      li.appendChild(probe);
      li.appendChild(info);
      li.appendChild(b);
      ul.appendChild(li);
    }
  }
  async function refreshAll() {
    await refreshDashboardCards();
    applyCombinedPanelVisibility();
    if (localStorage.getItem("combined-graph") === "true") {
      await refreshCombinedChart();
    } else {
      await buildIndividualChartPanels();
    }
  }
  function connectWS() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + "/ws");
    ws.onmessage = () => {
      refreshAll().catch(console.error);
      void fetchNextRunForTimer();
    };
    ws.onclose = () => setTimeout(connectWS, 2e3);
  }
  async function loadPrefs() {
    const p = await fetchJSON("/api/preferences");
    $("pref-save-manual-runs").checked = p.save_manual_runs;
    $("pref-default-domain").value = p.default_query_domain || "example.com";
  }
  async function savePrefsPartial(body) {
    await fetchJSON("/api/preferences", { method: "PATCH", body: JSON.stringify(body) });
  }
  async function main() {
    const tmpl = $("pref-template").value || localStorage.getItem("template") || "modern";
    await refreshSchemes(tmpl);
    $("pref-template").value = localStorage.getItem("template") || tmpl;
    $("pref-combined-graph").checked = localStorage.getItem("combined-graph") === "true";
    $("pref-logarithmic-scale").checked = localStorage.getItem("logarithmic-scale") === "true";
    await loadPrefs();
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.view || "dashboard"));
    });
    $("sidebar-toggle").addEventListener("click", () => {
      $("sidebar").classList.toggle("collapsed");
    });
    $("range-combined").addEventListener(
      "change",
      () => refreshCombinedChart().catch(console.error)
    );
    $("pref-combined-graph").addEventListener("change", (e) => {
      localStorage.setItem("combined-graph", e.target.checked ? "true" : "false");
      applyCombinedPanelVisibility();
      refreshAll().catch(console.error);
    });
    $("pref-logarithmic-scale").addEventListener("change", (e) => {
      localStorage.setItem("logarithmic-scale", e.target.checked ? "true" : "false");
      refreshCombinedChart().catch(console.error);
    });
    $("pref-template").addEventListener("change", async () => {
      const t = $("pref-template").value;
      await refreshSchemes(t);
      const sc = $("pref-scheme").value;
      applyTheme(t, sc);
    });
    $("pref-scheme").addEventListener("change", () => {
      applyTheme(
        $("pref-template").value,
        $("pref-scheme").value
      );
    });
    $("pref-save-manual-runs").addEventListener("change", async (e) => {
      await savePrefsPartial({ save_manual_runs: e.target.checked });
    });
    let domainTimer = null;
    $("pref-default-domain").addEventListener("input", () => {
      if (domainTimer) clearTimeout(domainTimer);
      domainTimer = setTimeout(async () => {
        await savePrefsPartial({
          default_query_domain: $("pref-default-domain").value.trim() || "example.com"
        });
      }, 500);
    });
    $("pref-clear-all-data").addEventListener("click", async () => {
      const ok = await showConfirm(
        "Clear all results?",
        "This permanently deletes every stored DNS probe run. Resolvers, schedules, and preferences are kept. Continue?",
        "Clear all",
        true
      );
      if (!ok) return;
      try {
        await fetchJSON("/api/history", { method: "DELETE" });
      } catch (e) {
        console.error(e);
        window.alert("Could not clear results. Check the connection and try again.");
        return;
      }
      historyPage = 0;
      await loadHistoryPage();
      await refreshDashboardCards();
      await refreshAll();
    });
    $("history-per-page").addEventListener("change", () => {
      historyPerPage = parseInt($("history-per-page").value, 10);
      historyPage = 0;
      loadHistoryPage().catch(console.error);
    });
    $("history-page-first").addEventListener("click", () => {
      historyPage = 0;
      loadHistoryPage().catch(console.error);
    });
    $("history-page-prev").addEventListener("click", () => {
      historyPage = Math.max(0, historyPage - 1);
      loadHistoryPage().catch(console.error);
    });
    $("history-page-next").addEventListener("click", () => {
      const pages = Math.max(1, Math.ceil(historyTotal / historyPerPage));
      historyPage = Math.min(pages - 1, historyPage + 1);
      loadHistoryPage().catch(console.error);
    });
    $("history-page-last").addEventListener("click", () => {
      const pages = Math.max(1, Math.ceil(historyTotal / historyPerPage));
      historyPage = pages - 1;
      loadHistoryPage().catch(console.error);
    });
    $("schedule-form-type").addEventListener("change", syncScheduleFields);
    syncScheduleFields();
    $("schedule-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const body = {
        id: $("schedule-form-id").value || "",
        name: $("schedule-form-name").value.trim(),
        enabled: $("schedule-form-enabled").checked,
        type: $("schedule-form-type").value,
        every: $("schedule-form-every").value.trim(),
        time_of_day: $("schedule-form-timeOfDay").value.trim()
      };
      if (editingScheduleId) {
        await fetchJSON("/api/schedules/" + encodeURIComponent(editingScheduleId), {
          method: "PUT",
          body: JSON.stringify(body)
        });
      } else {
        await fetchJSON("/api/schedules", { method: "POST", body: JSON.stringify(body) });
      }
      editingScheduleId = null;
      $("schedule-form-id").value = "";
      $("schedule-form-name").value = "";
      $("schedule-form-submit").textContent = "Add";
      $("schedule-form-cancel").style.display = "none";
      await loadSchedules();
      void fetchNextRunForTimer();
    });
    $("schedule-form-cancel").addEventListener("click", () => {
      editingScheduleId = null;
      $("schedule-form-id").value = "";
      $("schedule-form-submit").textContent = "Add";
      $("schedule-form-cancel").style.display = "none";
    });
    $("add-resolver").addEventListener("click", async () => {
      const name = $("new-res-name").value.trim();
      const address = $("new-res-addr").value.trim();
      if (!name || !address) return;
      await fetchJSON("/api/resolvers", { method: "POST", body: JSON.stringify({ name, address }) });
      $("new-res-name").value = "";
      $("new-res-addr").value = "";
      await refreshAll();
      await renderResolverList(await loadResolvers());
    });
    function showResultModal(title, html) {
      $("result-modal-title").textContent = title;
      $("result-modal-body").innerHTML = html;
      $("result-modal").style.display = "flex";
    }
    $("result-modal-close").addEventListener("click", () => {
      $("result-modal").style.display = "none";
    });
    $("run-now-btn").addEventListener("click", async () => {
      const all = await loadResolvers();
      const resolvers = resolversToProbe(all);
      if (!resolvers.length) {
        alert("Enable at least one resolver under Preferences (Probe checkbox).");
        return;
      }
      const domain = $("pref-default-domain").value.trim() || (await fetchJSON("/api/preferences")).default_query_domain;
      $("progress-modal").style.display = "flex";
      $("progress-status").textContent = "Probing";
      let i = 0;
      const spin = setInterval(() => {
        const r = resolvers[i % resolvers.length];
        $("progress-message").textContent = r ? `Querying ${r.name}\u2026` : "\u2026";
        i++;
      }, 400);
      try {
        const out = await fetchJSON("/api/run", {
          method: "POST",
          body: JSON.stringify({ domain })
        });
        clearInterval(spin);
        $("progress-modal").style.display = "none";
        let rows = "";
        for (const r of out.results) {
          rows += `<tr><td>${r.resolver_name || r.resolver_id}</td><td>${formatNumber(r.latency_ms, 2)} ms</td><td>${r.rcode}</td></tr>`;
        }
        const note = out.saved ? `Run saved (${out.run_id.slice(0, 8)}\u2026).` : "Not saved (enable in Preferences).";
        showResultModal("Probe complete", `<p class="muted">${note}</p><table class="table"><thead><tr><th>Resolver</th><th>Latency</th><th>RCODE</th></tr></thead><tbody>${rows}</tbody></table>`);
        await refreshAll();
        void fetchNextRunForTimer();
      } catch (e) {
        clearInterval(spin);
        $("progress-modal").style.display = "none";
        alert(e instanceof Error ? e.message : String(e));
      }
    });
    startScheduleTimer();
    await refreshAll();
    connectWS();
  }
  document.addEventListener("DOMContentLoaded", () => main().catch(console.error));
})();
//# sourceMappingURL=main.js.map
