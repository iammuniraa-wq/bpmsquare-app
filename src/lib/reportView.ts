// Normalizes a /api/reports/ask (or /api/reports/[id]) response into the
// shape ChartRenderer consumes. Pure client-safe logic, no framework import.

export type ChartType = "stat" | "bar" | "line" | "table";

export type ReportPayload = {
  status?: "ready";
  question?: string;
  object?: string;
  object_label?: string;
  chart_type?: ChartType;
  title?: string;
  interpretation?: string;
  dropped_sensitive_fields?: string[];
  compiled_query?: string;
  data?: Record<string, unknown>[];
  groups?: { key: unknown; count: number; [agg: string]: unknown } | { key: unknown; count: number; [agg: string]: unknown }[] | null;
  aggregates?: Record<string, number> | null;
  total?: number;
};

export type NormalizedReport = {
  chartType: ChartType;
  title: string;
  interpretation: string;
  droppedSensitiveFields: string[];
  // stat
  statValue?: number;
  // bar / line
  series?: { key: string; value: number }[];
  // table
  tableRows?: Record<string, unknown>[];
  tableColumns?: string[];
};

function firstAggregateValue(aggregates: Record<string, number> | null | undefined): number | undefined {
  if (!aggregates) return undefined;
  const values = Object.values(aggregates);
  return values.length ? values[0] : undefined;
}

function firstAggregateKey(group: Record<string, unknown>): string | null {
  const key = Object.keys(group).find((k) => k !== "key" && k !== "count");
  return key ?? null;
}

export function normalizeReport(payload: ReportPayload): NormalizedReport {
  const chartType = payload.chart_type ?? "table";
  const base = {
    chartType,
    title: payload.title || payload.question || "Report",
    interpretation: payload.interpretation || "",
    droppedSensitiveFields: payload.dropped_sensitive_fields ?? [],
  };

  if (chartType === "stat") {
    // Prefer the actual aggregate (sum/avg/...) when one was requested --
    // `total` is always present (it's the matched-row count) even when the
    // question asked for a SUM, so checking it first would silently show
    // "how many rows" instead of the value the user actually asked for.
    // Only a count_only question (no aggregates requested) falls through to
    // `total`, which is exactly the row count in that case.
    const value = firstAggregateValue(payload.aggregates) ?? payload.total ?? 0;
    return { ...base, statValue: value };
  }

  const groupsArr = Array.isArray(payload.groups) ? payload.groups : payload.groups ? [payload.groups] : [];
  if ((chartType === "bar" || chartType === "line") && groupsArr.length > 0) {
    const aggKey = firstAggregateKey(groupsArr[0]);
    const series = groupsArr.map((g) => ({
      key: g.key === null || g.key === undefined || g.key === "" ? "(none)" : String(g.key),
      value: aggKey ? Number(g[aggKey] ?? 0) : g.count,
    }));
    return { ...base, series };
  }

  const rows = payload.data ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]).filter((k) => k !== "_links") : [];
  return { ...base, tableRows: rows, tableColumns: columns };
}
