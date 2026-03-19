import type { RangeKey } from "./types.js";

export function formatNumber(
  val: number | undefined | null,
  digits = 2
): string {
  if (val == null || Number.isNaN(val)) return "–";
  return val.toFixed(digits);
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatTime24h(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

export function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${formatTime24h(date)}`;
}

export function formatChartXLabel(
  date: Date,
  range: RangeKey,
  previousLabelDate: Date | null
): string {
  if (range === "24h") {
    const showDate =
      !previousLabelDate ||
      date.getDate() !== previousLabelDate.getDate() ||
      date.getMonth() !== previousLabelDate.getMonth();
    if (showDate) return `${formatDate(date)} ${formatTime24h(date)}`;
    return formatTime24h(date);
  }
  if (range === "7d") return formatDate(date);
  if (range === "30d") return date.getDay() === 1 ? formatDate(date) : "";
  return formatTime24h(date);
}
