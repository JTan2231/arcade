import { useEffect, useState } from "react";

import type { DailyFeed, DailyFeedSchedule, EvidenceFormat } from "../../types";
import { RowActionMenu, type RowAction } from "../RowActionMenu";
import { FeedSettingsDialog } from "./FeedSettingsDialog";

export function FeedSublist({
  feeds,
  evidenceFormats,
  loading,
  error,
  manage,
  selectedFeedId,
  pendingToggleFeedId,
  pendingFeedCaptionsFeedId,
  pendingFeedFormatFeedId,
  pendingFeedScheduleFeedId,
  pendingRefreshFeedId,
  pendingDeleteFeedId,
  publicLinksAvailable,
  onSelectFeed,
  onToggleFeedEnabled,
  onToggleFeedCaptions,
  onChangeFeedFormat,
  onChangeFeedSchedule,
  onRefreshFeedGeneration,
  onManageFeedEvents,
  onCopyPublicFeedLink,
  onDeleteFeed,
  onAddFeed,
  onAmbientSpotlightTargetChange,
}: {
  feeds: DailyFeed[];
  evidenceFormats: EvidenceFormat[];
  loading: boolean;
  error: string;
  manage: boolean;
  selectedFeedId: string | null;
  pendingToggleFeedId: string | null;
  pendingFeedCaptionsFeedId: string | null;
  pendingFeedFormatFeedId: string | null;
  pendingFeedScheduleFeedId: string | null;
  pendingRefreshFeedId: string | null;
  pendingDeleteFeedId: string | null;
  publicLinksAvailable: boolean;
  onSelectFeed: (id: string) => void;
  onToggleFeedEnabled: (id: string) => void;
  onToggleFeedCaptions: (id: string) => void;
  onChangeFeedFormat: (feedId: string, evidenceFormatId: string) => void;
  onChangeFeedSchedule: (feedId: string, schedule: DailyFeedSchedule) => void;
  onRefreshFeedGeneration: (id: string) => void;
  onManageFeedEvents: (id: string) => void;
  onCopyPublicFeedLink: (id: string) => void;
  onDeleteFeed: (id: string) => void;
  onAddFeed: () => void;
  onAmbientSpotlightTargetChange: (target: HTMLElement | null) => void;
}) {
  const [settingsFeedId, setSettingsFeedId] = useState<string | null>(null);

  useEffect(() => {
    if (settingsFeedId !== null && !feeds.some((feed) => feed.id === settingsFeedId)) {
      setSettingsFeedId(null);
    }
  }, [feeds, settingsFeedId]);

  if (loading) {
    return (
      <section className="feed-sublist" aria-label="Feeds">
        <div className="feed-branch feed-sublist-status">
          <div className="meta">Loading feeds...</div>
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="feed-sublist" aria-label="Feeds">
        <div className="feed-branch feed-sublist-status">
          <div className="form-error" role="alert">
            {error}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="feed-sublist" aria-label="Feeds">
      {!feeds.length ? (
        <div className="feed-branch feed-sublist-status">
          <div className="meta">{manage ? "No feeds yet." : "No feeds are available for this group."}</div>
        </div>
      ) : null}
      {feeds.map((feed) => {
        const selected = feed.id === selectedFeedId;
        const feedSelectClassName = [
          "row-select-button",
          "nav-select-button",
          "feed-select-button",
          selected ? "nav-select-button-selected" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const mutating =
          pendingToggleFeedId === feed.id ||
          pendingFeedCaptionsFeedId === feed.id ||
          pendingFeedFormatFeedId === feed.id ||
          pendingFeedScheduleFeedId === feed.id ||
          pendingRefreshFeedId === feed.id ||
          pendingDeleteFeedId === feed.id;
        const copyPublicLinkAction: RowAction | null =
          publicLinksAvailable && feed.enabled
            ? {
                label: "Copy link",
                disabled: mutating,
                onSelect: () => onCopyPublicFeedLink(feed.id),
              }
            : null;
        const actions: RowAction[] = manage
          ? [
              {
                label: "Settings",
                disabled: mutating,
                onSelect: () => setSettingsFeedId(feed.id),
              },
              ...(copyPublicLinkAction === null ? [] : [copyPublicLinkAction]),
            ]
          : copyPublicLinkAction === null
            ? []
            : [copyPublicLinkAction];

        return (
          <div className="feed-branch" key={feed.id}>
            <div className={`row action-row nav-row feed-row ${selected ? "selected-row" : ""}`}>
              <button
                aria-pressed={selected}
                className={feedSelectClassName}
                type="button"
                aria-label={feed.name}
                onClick={() => onSelectFeed(feed.id)}
                onMouseEnter={(event) => onAmbientSpotlightTargetChange(event.currentTarget)}
                onMouseLeave={() => onAmbientSpotlightTargetChange(null)}
              >
                <div className="title">{feed.name}</div>
                <div className="meta">{!feed.enabled ? "Disabled" : ""}</div>
              </button>
              {actions.length > 0 ? <RowActionMenu label={`Feed settings for ${feed.name}`} actions={actions} /> : null}
            </div>
            {settingsFeedId === feed.id ? (
              <FeedSettingsDialog
                feed={feed}
                evidenceFormats={evidenceFormats}
                mutating={mutating}
                onClose={() => setSettingsFeedId(null)}
                onDeleteFeed={() => {
                  setSettingsFeedId(null);
                  onDeleteFeed(feed.id);
                }}
                onToggleFeedEnabled={() => {
                  setSettingsFeedId(null);
                  onToggleFeedEnabled(feed.id);
                }}
                onToggleFeedCaptions={() => onToggleFeedCaptions(feed.id)}
                onChangeFeedFormat={(evidenceFormatId) => onChangeFeedFormat(feed.id, evidenceFormatId)}
                onChangeFeedSchedule={(schedule) => onChangeFeedSchedule(feed.id, schedule)}
                onRefreshGeneration={() => {
                  setSettingsFeedId(null);
                  onRefreshFeedGeneration(feed.id);
                }}
                onManageEvents={() => {
                  setSettingsFeedId(null);
                  onManageFeedEvents(feed.id);
                }}
              />
            ) : null}
          </div>
        );
      })}
      {manage ? (
        <div className="feed-branch">
          <button
            className="add-feed-button nav-add-feed-button"
            type="button"
            aria-label="Add feed"
            onClick={onAddFeed}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
