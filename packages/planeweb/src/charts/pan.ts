import { hideChartTooltip } from "./tooltip.js";
import type { ChartPanState } from "../types.js";

export const MIN_POINTS_FOR_PAN = 10;
export const DEFAULT_PAN_WINDOW_FRACTION = 0.4;

export function sliceRowsForPan<T>(
  rows: T[],
  pan: ChartPanState
): T[] {
  if (rows.length <= MIN_POINTS_FOR_PAN) return rows;
  const visibleCount = Math.max(
    1,
    Math.min(rows.length, Math.ceil(rows.length * pan.windowFraction))
  );
  const maxStart = Math.max(0, rows.length - visibleCount);
  const startIndex = Math.min(maxStart, Math.round(pan.offset * maxStart));
  return rows.slice(startIndex, startIndex + visibleCount);
}

export function setupChartPan(
  container: HTMLElement,
  pan: ChartPanState,
  onPanChange: () => void
): void {
  const prev = (container as HTMLElement & { __panAbort?: AbortController })
    .__panAbort;
  if (prev) prev.abort();
  const controller = new AbortController();
  (container as HTMLElement & { __panAbort?: AbortController }).__panAbort =
    controller;
  const { signal } = controller;

  let dragging = false;
  let startClientX = 0;
  let startOffset = 0;

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    hideChartTooltip();
    dragging = true;
    startClientX = e.clientX;
    startOffset = pan.offset;
    container.style.cursor = "grabbing";
    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging) return;
    const chartWidth = container.clientWidth || 300;
    const deltaX = e.clientX - startClientX;
    const offsetDelta = deltaX / chartWidth;
    pan.offset = Math.max(0, Math.min(1, startOffset + offsetDelta));
    startClientX = e.clientX;
    startOffset = pan.offset;
    onPanChange();
  };

  const onMouseUp = (): void => {
    if (!dragging) return;
    dragging = false;
    container.style.cursor = "grab";
  };

  container.addEventListener("mousedown", onMouseDown as EventListener, {
    signal,
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
