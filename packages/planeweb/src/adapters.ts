import type { TimeSeriesRow } from "./types.js";

/** Map Speedplane-style API rows into planeweb TimeSeriesRow */
export function speedtestRowToTimeSeries(r: {
  timestamp: string;
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
  jitter_ms?: number;
}): TimeSeriesRow {
  return {
    timestamp: r.timestamp,
    values: {
      download_mbps: r.download_mbps,
      upload_mbps: r.upload_mbps,
      ping_ms: r.ping_ms,
      jitter_ms: r.jitter_ms ?? 0,
    },
  };
}
