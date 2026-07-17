import { useCallback, useEffect, useState } from "react";

import type { CreateFeedMetricRequest, DailyFeed, FeedMetric, PatchFeedMetricRequest } from "../types";
import { CreateMetricDialog, EditMetricDialog } from "./CreateMetricDialog";
import { aggregationLabel, metricKeyLabel } from "./metricLabels";

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
  const [editAwaitingResult, setEditAwaitingResult] = useState(false);
  const [editSawSubmitting, setEditSawSubmitting] = useState(false);
  const [editError, setEditError] = useState("");
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
    setEditAwaitingResult(false);
    setEditSawSubmitting(false);
    setEditError("");
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

  useEffect(() => {
    if (dialogMode !== "edit" || !editAwaitingResult || editingMetricId === null) {
      return;
    }
    if (updatingMetricId === editingMetricId) {
      setEditSawSubmitting(true);
      return;
    }
    if (!editSawSubmitting || updatingMetricId !== null) {
      return;
    }
    if (error === "") {
      closeDialog();
      return;
    }
    setEditError(error);
    setEditAwaitingResult(false);
    setEditSawSubmitting(false);
  }, [closeDialog, dialogMode, editAwaitingResult, editingMetricId, editSawSubmitting, error, updatingMetricId]);

  function openCreateDialog() {
    setCreateError("");
    setDialogMode("create");
  }

  function openEditDialog(metric: FeedMetric) {
    setEditError("");
    setEditAwaitingResult(false);
    setEditSawSubmitting(false);
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
          <div className="meta">{selectedFeed === null ? "No feed selected" : `Feed: ${selectedFeed.name}`}</div>
        </div>
        <button
          aria-haspopup="dialog"
          className="secondary"
          type="button"
          disabled={!canAddMetric}
          onClick={openCreateDialog}
        >
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
                      aria-haspopup="dialog"
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

      {dialogMode === "edit" && editingMetric !== null && selectedFeed !== null ? (
        <EditMetricDialog
          feedName={selectedFeed.name}
          metric={editingMetric}
          saving={updatingMetricId === editingMetric.id || editAwaitingResult}
          submissionError={editError}
          onClose={closeDialog}
          onUpdate={(payload) => {
            setEditError("");
            setEditAwaitingResult(true);
            onUpdateMetric(editingMetric.id, payload);
          }}
        />
      ) : null}
    </section>
  );
}
