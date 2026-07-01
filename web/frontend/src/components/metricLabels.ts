import type { FeedMetricKey, MetricAggregation, SystemMetricKey } from "../types";

const systemMetricOptions: Array<{
  key: SystemMetricKey;
  label: string;
  aggregations: MetricAggregation[];
  defaultAggregation: MetricAggregation;
}> = [
  { key: "post_count", label: "Post count", aggregations: ["count", "sum"], defaultAggregation: "count" },
  {
    key: "average_post_length_words",
    label: "Average post length",
    aggregations: ["average", "max", "min"],
    defaultAggregation: "average",
  },
  { key: "missed_days", label: "Missed days", aggregations: ["count", "sum"], defaultAggregation: "count" },
  { key: "current_streak", label: "Current streak", aggregations: ["latest", "max"], defaultAggregation: "latest" },
  {
    key: "typical_posting_window",
    label: "Typical posting window",
    aggregations: ["latest"],
    defaultAggregation: "latest",
  },
];

const judgedAggregations: MetricAggregation[] = ["average", "sum", "latest", "count", "max", "min"];

export function metricKeyLabel(key: FeedMetricKey): string {
  if (key === "judged") {
    return "Judged";
  }
  return systemMetricOptions.find((option) => option.key === key)?.label ?? key;
}

export function aggregationLabel(aggregation: MetricAggregation): string {
  switch (aggregation) {
    case "sum":
      return "Sum";
    case "average":
      return "Average";
    case "latest":
      return "Latest";
    case "count":
      return "Count";
    case "max":
      return "Max";
    case "min":
      return "Min";
  }
}

export function aggregationsForMetricKey(key: FeedMetricKey): MetricAggregation[] {
  if (key === "judged") {
    return judgedAggregations;
  }
  return systemMetricOptions.find((option) => option.key === key)?.aggregations ?? ["average"];
}

export function defaultAggregationForMetricKey(key: FeedMetricKey): MetricAggregation {
  if (key === "judged") {
    return "average";
  }
  return systemMetricOptions.find((option) => option.key === key)?.defaultAggregation ?? "average";
}

export function defaultMetricDisplayName(key: SystemMetricKey): string {
  return systemMetricOptions.find((option) => option.key === key)?.label ?? "";
}

export function systemMetricOptionEntries(): Array<{ key: SystemMetricKey; label: string }> {
  return systemMetricOptions.map(({ key, label }) => ({ key, label }));
}
