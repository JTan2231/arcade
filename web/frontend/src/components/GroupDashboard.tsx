import { feedDateOptions, formatDateLabel } from "../dates";
import type { DailyFeed, DailyFeedAction, DailyFeedOutput, DailyFeedOutputItem, Group } from "../types";

type GroupDashboardProps = {
  group: Group | null;
  feeds: DailyFeed[];
  feedsLoading: boolean;
  feedsError: string;
  selectedFeedId: string | null;
  selectedFeedDate: string;
  output: DailyFeedOutput | null;
  outputLoading: boolean;
  outputError: string;
  onSelectFeed: (id: string) => void;
  onChangeFeedDate: (date: string) => void;
  onToggleFeedEnabled: (id: string) => void;
};

export function GroupDashboard({
  group,
  feeds,
  feedsLoading,
  feedsError,
  selectedFeedId,
  selectedFeedDate,
  output,
  outputLoading,
  outputError,
  onSelectFeed,
  onChangeFeedDate,
  onToggleFeedEnabled,
}: GroupDashboardProps) {
  if (!group) {
    return (
      <section className="panel group-dashboard-panel">
        <div className="empty-state">
          <div className="title">No group selected</div>
          <div className="meta">Create or open a group to view feeds.</div>
        </div>
      </section>
    );
  }

  const manage = canManageGroup(group);
  const feed = feeds.find((candidate) => candidate.id === selectedFeedId) || null;

  return (
    <section className="panel group-dashboard-panel">
      <div className="dashboard-grid">
        <section className="dashboard-section feeds-section" aria-label="Feeds">
          <FeedList
            feeds={feeds}
            loading={feedsLoading}
            error={feedsError}
            manage={manage}
            selectedFeedId={selectedFeedId}
            onSelectFeed={onSelectFeed}
          />
        </section>

        <section className="dashboard-section feed-output-section" aria-label="Selected feed output">
          {feed ? (
            <div className="output-actions feed-output-toolbar">
              {manage ? (
                <button
                  className="secondary"
                  type="button"
                  aria-label={feed.enabled ? "Disable feed" : "Enable feed"}
                  onClick={() => onToggleFeedEnabled(feed.id)}
                >
                  Manage
                </button>
              ) : null}
              <label className="date-control">
                Date
                <select value={selectedFeedDate} onChange={(event) => onChangeFeedDate(event.target.value)}>
                  {feedDateOptions(selectedFeedDate).map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          <FeedOutput feed={feed} output={output} loading={outputLoading} error={outputError} />
        </section>
      </div>
    </section>
  );
}

function FeedList({
  feeds,
  loading,
  error,
  manage,
  selectedFeedId,
  onSelectFeed,
}: {
  feeds: DailyFeed[];
  loading: boolean;
  error: string;
  manage: boolean;
  selectedFeedId: string | null;
  onSelectFeed: (id: string) => void;
}) {
  if (loading) {
    return <div className="empty-state">Loading feeds...</div>;
  }
  if (error) {
    return (
      <div className="form-error" role="alert">
        {error}
      </div>
    );
  }
  if (!feeds.length) {
    return <div className="empty-state">{manage ? "No feeds yet." : "No feeds are available for this group."}</div>;
  }

  return (
    <div className="stack">
      {feeds.map((feed) => {
        const selected = feed.id === selectedFeedId;

        return (
          <button
            aria-pressed={selected}
            className={`row selectable-row feed-row ${selected ? "selected-row" : ""}`}
            key={feed.id}
            type="button"
            onClick={() => onSelectFeed(feed.id)}
          >
            <div className="title">{feed.name}</div>
            {!feed.enabled ? <div className="meta">Disabled</div> : null}
          </button>
        );
      })}
    </div>
  );
}

function FeedOutput({
  feed,
  output,
  loading,
  error,
}: {
  feed: DailyFeed | null;
  output: DailyFeedOutput | null;
  loading: boolean;
  error: string;
}) {
  if (!feed) {
    return <div className="empty-state">Select a feed to view its daily output.</div>;
  }
  if (loading) {
    return <div className="empty-state">Loading output...</div>;
  }
  if (error) {
    return (
      <div className="form-error" role="alert">
        {error}
      </div>
    );
  }
  if (!output) {
    return <div className="empty-state">No output loaded.</div>;
  }
  if (!output.items?.length) {
    return <div className="empty-state">No generated items for {output.date}.</div>;
  }

  return (
    <>
      <div className="output-summary">
        <div className="title">{output.title}</div>
        <div className="meta">{formatDateLabel(output.date)}</div>
      </div>
      <div className="stack output-items">
        {output.items.map((item) => (
          <OutputItem item={item} key={`${item.position}-${item.item?.id || item.role}`} />
        ))}
      </div>
    </>
  );
}

function OutputItem({ item }: { item: DailyFeedOutputItem }) {
  const catalogItem = item.item || {};
  const data = catalogItem.data || {};
  const rating = primitiveDisplay(data.rating);
  const tags = Array.isArray(data.tags)
    ? data.tags
        .filter((tag): tag is string => typeof tag === "string")
        .slice(0, 4)
        .join(", ")
    : "";
  const details = [catalogItem.source_name, rating ? `Rating ${rating}` : "", tags].filter(Boolean);

  return (
    <div className="row output-item">
      <div className="output-item-main">
        <div className="item-position">{item.position}</div>
        <div>
          <div className="title">{catalogItem.title || "Untitled"}</div>
          {details.map((detail) => (
            <div className="meta" key={detail}>
              {detail}
            </div>
          ))}
          <div className="meta">{item.reason || ""}</div>
        </div>
      </div>
      <div className="output-item-side">
        <span className="pill">{item.role || "target"}</span>
        <span className="pill">{item.points || 0} pts</span>
        <OutputAction action={item.action} />
      </div>
    </div>
  );
}

function OutputAction({ action }: { action?: DailyFeedAction }) {
  if (action?.type === "external_url" && action.url) {
    return (
      <a className="button-link" href={action.url} target="_blank" rel="noreferrer">
        {action.label || "Open"}
      </a>
    );
  }

  if (action?.type === "text" && action.text) {
    return (
      <details className="prompt-details">
        <summary>{action.label || "Prompt"}</summary>
        <pre>{action.text}</pre>
      </details>
    );
  }

  return null;
}

function canManageGroup(group: Group | null): boolean {
  return group?.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
}

function primitiveDisplay(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}
