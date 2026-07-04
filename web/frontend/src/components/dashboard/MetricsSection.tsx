import { useEffect, useRef, useState } from "react";

import type { DailyFeed, FeedMetric, MetricLeaderboard, MetricLeaderboardRow, PublicUser } from "../../types";
import { metricKeyLabel } from "../metricLabels";

export function MetricsSection({
  feed,
  metrics,
  selectedMetricId,
  leaderboard,
  metricsLoading,
  leaderboardLoading,
  error,
  onAddMetric,
  onSelectMetric,
}: {
  feed: DailyFeed | null;
  metrics: FeedMetric[];
  selectedMetricId: string | null;
  leaderboard: MetricLeaderboard | null;
  metricsLoading: boolean;
  leaderboardLoading: boolean;
  error: string;
  onAddMetric?: () => void;
  onSelectMetric: (metricId: string) => void;
}) {
  const selectedMetric = metrics.find((metric) => metric.id === selectedMetricId) ?? null;
  const [metricMenuOpen, setMetricMenuOpen] = useState(false);
  const metricMenuRef = useRef<HTMLDivElement>(null);
  const canChooseMetric = metrics.length > 0 && !metricsLoading;
  const metricTitle = selectedMetric?.display_name ?? "Metrics";
  const selectedMetricPrompt = selectedMetric?.judgment_prompt ?? "";

  function selectNextMetric() {
    if (!canChooseMetric) {
      return;
    }

    const selectedIndex = metrics.findIndex((metric) => metric.id === selectedMetricId);
    const nextIndex = selectedIndex >= 0 ? (selectedIndex + 1) % metrics.length : 0;
    const nextMetric = metrics[nextIndex];
    if (nextMetric === undefined) {
      return;
    }

    if (nextMetric.id !== selectedMetricId) {
      onSelectMetric(nextMetric.id);
    }
  }

  useEffect(() => {
    if (!metricMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      if (metricMenuRef.current?.contains(event.target as Node) === true) {
        return;
      }
      setMetricMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMetricMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [metricMenuOpen]);

  useEffect(() => {
    setMetricMenuOpen(false);
  }, [feed?.id, selectedMetricId]);

  if (!feed) {
    return null;
  }

  return (
    <section className="metrics-section" aria-label="Metrics">
      <div className="panel-header groups-panel-header metric-rail-header">
        <div className="metric-title-menu" ref={metricMenuRef}>
          <h2>
            {canChooseMetric ? (
              <span className="metric-title-control">
                <button className="metric-title-button" type="button" onClick={selectNextMetric}>
                  <span className="metric-title-text">{metricTitle}</span>
                </button>
                <button
                  aria-expanded={metricMenuOpen}
                  aria-haspopup="true"
                  aria-label="Metric choices"
                  className="metric-title-caret-button"
                  type="button"
                  onClick={() => setMetricMenuOpen((current) => !current)}
                >
                  <span className="metric-title-caret" aria-hidden="true">
                    <span />
                    <span />
                  </span>
                </button>
              </span>
            ) : (
              <span className="metric-title-static">{metricTitle}</span>
            )}
          </h2>
          {metricMenuOpen ? (
            <div className="metric-title-menu-panel" aria-label="Metric choices">
              {metrics.map((metric) => (
                <button
                  aria-label={`Select ${metric.display_name}`}
                  aria-pressed={metric.id === selectedMetricId}
                  className="metric-title-menu-option"
                  key={metric.id}
                  type="button"
                  onClick={() => {
                    setMetricMenuOpen(false);
                    if (metric.id !== selectedMetricId) {
                      onSelectMetric(metric.id);
                    }
                  }}
                >
                  <span className="title">{metric.display_name}</span>
                  <span className="meta">{metricKeyLabel(metric.system_key)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {onAddMetric !== undefined ? (
          <button aria-label="Add metric" className="icon-button metric-add-button" type="button" onClick={onAddMetric}>
            <span aria-hidden="true">+</span>
          </button>
        ) : null}
      </div>
      {selectedMetricPrompt !== "" ? <div className="meta metric-rail-summary">{selectedMetricPrompt}</div> : null}

      {metricsLoading ? <div className="meta">Loading metrics...</div> : null}
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      {!metricsLoading && metrics.length === 0 && !error ? <div className="meta">No metrics configured.</div> : null}

      {metrics.length > 0 ? (
        <div className="metric-layout">
          <div className="leaderboard-panel">
            {leaderboardLoading ? <div className="meta">Loading leaderboard...</div> : null}
            {!leaderboardLoading && leaderboard ? <LeaderboardTable leaderboard={leaderboard} /> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LeaderboardTable({ leaderboard }: { leaderboard: MetricLeaderboard }) {
  if (leaderboard.rows.length === 0) {
    return <div className="meta">No active members.</div>;
  }
  const valueColumnLabel = leaderboardValueColumnLabel(leaderboard.metric);
  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Member</th>
          <th>{valueColumnLabel}</th>
        </tr>
      </thead>
      <tbody>
        {leaderboard.rows.map((row) => (
          <tr key={row.user.id}>
            <td>{leaderboardRankDisplay(row)}</td>
            <td>{publicUserDisplayName(row.user)}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function leaderboardValueColumnLabel(metric: FeedMetric): string {
  switch (metric.system_key) {
    case "post_count":
      return "Posts";
    case "average_post_length_words":
      if (metric.aggregation === "max") {
        return "Max words";
      }
      if (metric.aggregation === "min") {
        return "Min words";
      }
      return "Average words";
    case "missed_days":
      return "Missed days";
    case "current_streak":
      return "Streak days";
    case "typical_posting_window":
      return "Posting window";
    case "judged":
      return "Value";
  }
}

function leaderboardRankDisplay(row: MetricLeaderboardRow): string | number {
  return row.rank ?? "-";
}

function publicUserDisplayName(user: PublicUser): string {
  return user.display_name || user.username;
}
