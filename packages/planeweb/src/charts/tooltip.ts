const CHART_TOOLTIP_CLASS = "chart-tooltip";
let sharedChartTooltip: HTMLElement | null = null;

export function getOrCreateChartTooltip(): HTMLElement {
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

export function hideChartTooltip(): void {
  if (sharedChartTooltip) sharedChartTooltip.style.display = "none";
}
