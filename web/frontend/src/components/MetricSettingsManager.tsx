import { FormEvent, useCallback, useEffect, useState } from "react";

import type {
  CreateFeedMetricRequest,
  DailyFeed,
  FeedMetric,
  MetricAggregation,
  PatchFeedMetricRequest,
} from "../types";
import {
  aggregationLabel,
  aggregationsForMetricKey,
  defaultAggregationForMetricKey,
  metricKeyLabel,
} from "./metricLabels";
import { CreateMetricDialog } from "./CreateMetricDialog";

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
  const [createAwaitingResult, setCreateAwaitingResult] = useState(false);
  const [createSawSubmitting, setCreateSawSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const selectedFeed = feeds.find((feed) => feed.id === selectedFeedId) ?? null;
  const editingMetric =
    dialogMode === "edit" ? (metrics.find((metric) => metric.id === editingMetricId) ?? null) : null;
  const canAddMetric = selectedFeed !== null && !metricsLoading && !metricSubmitting;

  const closeDialog = useCallback(() => {
    setDialogMode(null);
    setEditingMetricId(null);
    setCreateAwaitingResult(false);
    setCreateSawSubmitting(false);
    setCreateError("");
  }, []);

  useEffect(() => {
    closeDialog();
  }, [closeDialog, selectedFeedId]);

  useEffect(() => {
    if (dialogMode !== "create" || !createAwaitingResult) {
      return;
    }
    if (metricSubmitting) {
      setCreateSawSubmitting(true);
      return;
    }
    if (!createSawSubmitting) {
      return;
    }
    if (error === "") {
      closeDialog();
      return;
    }
    setCreateError(error);
    setCreateAwaitingResult(false);
    setCreateSawSubmitting(false);
  }, [closeDialog, createAwaitingResult, createSawSubmitting, dialogMode, error, metricSubmitting]);

  function openCreateDialog() {
    setCreateError("");
    setDialogMode("create");
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
        <button className="secondary" type="button" disabled={!canAddMetric} onClick={openCreateDialog}>
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

      {dialogMode === "create" && selectedFeed !== null ? (
        <CreateMetricDialog
          feedName={selectedFeed.name}
          saving={metricSubmitting || createAwaitingResult}
          submissionError={createError}
          onClose={closeDialog}
          onCreate={(payload) => {
            setCreateError("");
            setCreateAwaitingResult(true);
            onCreateMetric(payload);
          }}
        />
      ) : null}

      {dialogMode === "edit" && editingMetric !== null ? (
        <EditMetricDialog
          metric={editingMetric}
          saving={updatingMetricId === editingMetric.id}
          onClose={closeDialog}
          onUpdate={(metricId, payload) => {
            onUpdateMetric(metricId, payload);
            closeDialog();
          }}
        />
      ) : null}
    </section>
  );
}

function EditMetricDialog({
  metric,
  saving,
  onClose,
  onUpdate,
}: {
  metric: FeedMetric;
  saving: boolean;
  onClose: () => void;
  onUpdate: (metricId: string, payload: PatchFeedMetricRequest) => void;
}) {
  const [displayName, setDisplayName] = useState(metric.display_name);
  const [aggregation, setAggregation] = useState<MetricAggregation>(metric.aggregation);
  const [judgmentPrompt, setJudgmentPrompt] = useState(metric.judgment_prompt ?? "");
  const [validationError, setValidationError] = useState("");
  const metricKey = metric.system_key;
  const allowedAggregations = aggregationsForMetricKey(metricKey);

  useEffect(() => {
    if (!allowedAggregations.includes(aggregation)) {
      setAggregation(defaultAggregationForMetricKey(metricKey));
    }
  }, [aggregation, allowedAggregations, metricKey]);

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

    onUpdate(metric.id, {
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
              <h2 id="metric-dialog-title">Edit metric</h2>
              <div className="meta">{metricKeyLabel(metricKey)}</div>
            </div>
            <button className="secondary" type="button" onClick={onClose}>
              Close
            </button>
          </div>

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

          {metric.system_key === "judged" ? (
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
