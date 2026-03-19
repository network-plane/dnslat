/** ISO timestamp string */
export type RangeKey = "24h" | "7d" | "30d";

/** Generic row for line/combined charts */
export type TimeSeriesRow = {
  timestamp: string;
  values: Record<string, number>;
};

export type ChartPanState = {
  offset: number;
  windowFraction: number;
};

export type SeriesDef = {
  key: string;
  name: string;
  unit: string;
  color: string;
};

export type PercentileStats = {
  min: number;
  p10: number;
  q1: number;
  median: number;
  q3: number;
  p90: number;
  max: number;
};

export type ChartDataResponse = {
  data: TimeSeriesRow[];
  stats?: PercentileStats;
  min_value: number;
  max_value: number;
};
