import { FormEvent, useEffect, useState } from "react";

import type {
  CreateFeedMetricRequest,
  DailyFeed,
  FeedMetric,
  FeedMetricKey,
  MetricAggregation,
  PatchFeedMetricRequest,
  SystemMetricKey,
} from "../types";
import {
  aggregationLabel,
  aggregationsForMetricKey,
  defaultAggregationForMetricKey,
  defaultMetricDisplayName,
  metricKeyLabel,
  systemMetricOptionEntries,
} from "./metricLabels";

type MetricSettingsManagerProps = {
  feeds: DailyFeed[];
  selectedFeedId: string | null;
  metrics: FeedMetric[];
  metricsLoading: boolean;
  error: string;
  metricSubmitting: boolean;
  updatingMetricId: string | null;
  deletingMetricId: string | null;
  onSelectFeed: (feedId: string) => void;
  onCreateMetric: (payload: CreateFeedMetricRequest) => void;
  onUpdateMetric: (metricId: string, payload: PatchFeedMetricRequest) => void;
  onDeleteMetric: (metricId: string) => void;
};

export function MetricSettingsManager({
  feeds,
  selectedFeedId,
  metrics,
  metricsLoading,
  error,
  metricSubmitting,
  updatingMetricId,
  deletingMetricId,
  onSelectFeed,
  onCreateMetric,
  onUpdateMetric,
  onDeleteMetric,
}: MetricSettingsManagerProps) {
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editingMetricId, setEditingMetricId] = useState<string | null>(null);
  const selectedFeed = feeds.find((feed) => feed.id === selectedFeedId) ?? null;
  const editingMetric =
    dialogMode === "edit" ? (metrics.find((metric) => metric.id === editingMetricId) ?? null) : null;
  const canAddMetric = selectedFeed !== null && !metricsLoading && !metricSubmitting;

  useEffect(() => {
    setDialogMode(null);
    setEditingMetricId(null);
  }, [selectedFeedId]);

  function closeDialog() {
    setDialogMode(null);
    setEditingMetricId(null);
  }

  function openEditDialog(metric: FeedMetric) {
    setEditingMetricId(metric.id);
    setDialogMode("edit");
  }

  function handleDeleteMetric(metric: FeedMetric) {
    if (deletingMetricId !== null || !window.confirm(`Delete ${metric.display_name}?`)) {
      return;
    }
    onDeleteMetric(metric.id);
  }

  return (
    <section className="metric-settings-manager" aria-label="Metric settings">
      <div className="section-header-row">
        <div>
          <div className="section-title">Metric settings</div>
          <div className="meta">{selectedFeed?.name ?? "No feed selected"}</div>
        </div>
        <button className="secondary" type="button" disabled={!canAddMetric} onClick={() => setDialogMode("create")}>
          Add metric
        </button>
      </div>

      {feeds.length > 1 ? (
        <label className="metric-settings-feed-control">
          Feed
          <select
            value={selectedFeedId ?? ""}
            onChange={(event) => {
              if (event.target.value !== "") {
                onSelectFeed(event.target.value);
              }
            }}
          >
            {selectedFeedId === null ? (
              <option value="" disabled>
                Select feed
              </option>
            ) : null}
            {feeds.map((feed) => (
              <option value={feed.id} key={feed.id}>
                {feed.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {feeds.length === 0 ? <div className="empty-state">No feeds available.</div> : null}
      {metricsLoading ? <div className="empty-state">Loading metrics...</div> : null}
      {error !== "" ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      {selectedFeed !== null && !metricsLoading && metrics.length === 0 && error === "" ? (
        <div className="empty-state">No metrics configured for this feed.</div>
      ) : null}

      {selectedFeed !== null && metrics.length > 0 ? (
        <div className="metric-settings-list">
          {metrics.map((metric) => {
            const busy = updatingMetricId === metric.id || deletingMetricId === metric.id;
            return (
              <div className="row metric-settings-row" key={metric.id}>
                <div className="metric-settings-row-header">
                  <div className="metric-settings-summary">
                    <div className="title">{metric.display_name}</div>
                    <div className="meta">
                      {metricKeyLabel(metric.system_key)} · {aggregationLabel(metric.aggregation)}
                    </div>
                  </div>
                  <div className="compact-actions">
                    <button
                      aria-label={`Edit ${metric.display_name}`}
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => openEditDialog(metric)}
                    >
                      Edit
                    </button>
                    <button
                      aria-label={`Delete ${metric.display_name}`}
                      className="danger"
                      type="button"
                      disabled={busy}
                      onClick={() => handleDeleteMetric(metric)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {metric.judgment_prompt !== undefined && metric.judgment_prompt !== "" ? (
                  <div className="meta">{metric.judgment_prompt}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {dialogMode === "create" || (dialogMode === "edit" && editingMetric !== null) ? (
        <MetricDialog
          mode={dialogMode}
          metric={editingMetric}
          saving={dialogMode === "create" ? metricSubmitting : updatingMetricId === editingMetric?.id}
          onClose={closeDialog}
          onCreate={(payload) => {
            onCreateMetric(payload);
            closeDialog();
          }}
          onUpdate={(metricId, payload) => {
            onUpdateMetric(metricId, payload);
            closeDialog();
          }}
        />
      ) : null}
    </section>
  );
}

function MetricDialog({
  mode,
  metric,
  saving,
  onClose,
  onCreate,
  onUpdate,
}: {
  mode: "create" | "edit";
  metric: FeedMetric | null;
  saving: boolean;
  onClose: () => void;
  onCreate: (payload: CreateFeedMetricRequest) => void;
  onUpdate: (metricId: string, payload: PatchFeedMetricRequest) => void;
}) {
  const editing = mode === "edit" && metric !== null;
  const initialKind = metric?.system_key === "judged" ? "judged" : "system";
  const initialSystemKey =
    metric?.system_key !== undefined && metric.system_key !== "judged" ? metric.system_key : "post_count";
  const [kind, setKind] = useState<"system" | "judged">(initialKind);
  const [systemKey, setSystemKey] = useState<SystemMetricKey>(initialSystemKey);
  const [displayName, setDisplayName] = useState(metric?.display_name ?? defaultMetricDisplayName(initialSystemKey));
  const [aggregation, setAggregation] = useState<MetricAggregation>(
    metric?.aggregation ?? defaultAggregationForMetricKey(initialSystemKey),
  );
  const [judgmentPrompt, setJudgmentPrompt] = useState(metric?.judgment_prompt ?? "");
  const [validationError, setValidationError] = useState("");

  const metricKey: FeedMetricKey = editing ? metric.system_key : kind === "judged" ? "judged" : systemKey;
  const allowedAggregations = aggregationsForMetricKey(metricKey);

  useEffect(() => {
    if (!allowedAggregations.includes(aggregation)) {
      setAggregation(defaultAggregationForMetricKey(metricKey));
    }
  }, [aggregation, allowedAggregations, metricKey]);

  function handleSystemKeyChange(nextKey: SystemMetricKey) {
    setSystemKey(nextKey);
    setAggregation(defaultAggregationForMetricKey(nextKey));
    if (mode === "create") {
      setDisplayName(defaultMetricDisplayName(nextKey));
    }
  }

  function handleKindChange(nextKind: "system" | "judged") {
    setKind(nextKind);
    const nextKey: FeedMetricKey = nextKind === "judged" ? "judged" : systemKey;
    setAggregation(defaultAggregationForMetricKey(nextKey));
    if (mode === "create") {
      setDisplayName(nextKind === "judged" ? "" : defaultMetricDisplayName(systemKey));
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedDisplayName = displayName.trim();
    const trimmedPrompt = judgmentPrompt.trim();
    if (trimmedDisplayName === "") {
      setValidationError("Name is required");
      return;
    }
    if (metricKey === "judged" && trimmedPrompt === "") {
      setValidationError("Prompt is required");
      return;
    }
    setValidationError("");

    if (editing) {
      onUpdate(metric.id, {
        display_name: trimmedDisplayName,
        aggregation,
        ...(metricKey === "judged" ? { judgment_prompt: trimmedPrompt } : {}),
      });
      return;
    }

    onCreate({
      system_key: metricKey,
      display_name: trimmedDisplayName,
      aggregation,
      ...(metricKey === "judged" ? { judgment_prompt: trimmedPrompt } : {}),
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel metric-dialog" role="dialog" aria-modal="true" aria-labelledby="metric-dialog-title">
        <form className="metric-form" onSubmit={handleSubmit}>
          <div className="modal-header">
            <div>
              <h2 id="metric-dialog-title">{editing ? "Edit metric" : "Add metric"}</h2>
              <div className="meta">{metricKeyLabel(metricKey)}</div>
            </div>
            <button className="secondary" type="button" onClick={onClose}>
              Close
            </button>
          </div>

          {!editing ? (
            <label>
              Type
              <select value={kind} onChange={(event) => handleKindChange(event.target.value as "system" | "judged")}>
                <option value="system">Calculated</option>
                <option value="judged">Judged</option>
              </select>
            </label>
          ) : null}

          {kind === "system" && !editing ? (
            <label>
              Metric
              <select
                value={systemKey}
                onChange={(event) => handleSystemKeyChange(event.target.value as SystemMetricKey)}
              >
                {systemMetricOptionEntries().map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="form-grid two-column">
            <label>
              Name
              <input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setValidationError("");
                }}
              />
            </label>
            <label>
              Aggregation
              <select value={aggregation} onChange={(event) => setAggregation(event.target.value as MetricAggregation)}>
                {allowedAggregations.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {aggregationLabel(candidate)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {metricKey === "judged" ? (
            <label>
              Prompt
              <textarea
                value={judgmentPrompt}
                onChange={(event) => {
                  setJudgmentPrompt(event.target.value);
                  setValidationError("");
                }}
              />
            </label>
          ) : null}

          {validationError ? (
            <div className="form-error" role="alert">
              {validationError}
            </div>
          ) : null}

          <div className="output-actions">
            <button className="secondary" type="button" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
