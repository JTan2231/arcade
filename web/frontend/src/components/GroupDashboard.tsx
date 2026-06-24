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
  const role = group.my_role || "viewer";
  const status = group.my_status || "not joined";

  return (
    <section className="panel group-dashboard-panel">
      <div className="dashboard-header">
        <div>
          <h2>{group.name}</h2>
          <div className="meta">
            {group.visibility} - {role} - {status}
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-section feeds-section">
          <div className="section-header">
            <h3>Feeds</h3>
          </div>
          <FeedList
            feeds={feeds}
            loading={feedsLoading}
            error={feedsError}
            manage={manage}
            selectedFeedId={selectedFeedId}
            onSelectFeed={onSelectFeed}
          />
        </section>

        <section className="dashboard-section feed-output-section">
          <div className="section-header output-header">
            <div>
              <h3>{feed ? feed.name : "Feed output"}</h3>
              {feed ? <div className="meta">{describeFeed(feed)}</div> : null}
            </div>
            {feed ? (
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
            ) : null}
          </div>

          {feed && manage ? (
            <div className="management-strip">
              <div>
                <div className="title">Feed management</div>
                <div className="meta">{feed.enabled ? "Enabled" : "Disabled"}</div>
              </div>
              <button className="secondary" type="button" onClick={() => onToggleFeedEnabled(feed.id)}>
                {feed.enabled ? "Disable" : "Enable"}
              </button>
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
        const enabled = feed.enabled ? "Enabled" : "Disabled";

        return (
          <div className={`row feed-row ${selected ? "selected-row" : ""}`} key={feed.id}>
            <div className="row-top feed-row-top">
              <div>
                <div className="title">{feed.name}</div>
                <div className="meta">
                  {enabled} - {describeAudience(feed.audience)}
                </div>
                <div className="meta">{describeSchedule(feed.schedule)}</div>
              </div>
              <div className="button-group">
                <button
                  className={selected ? "" : "secondary"}
                  type="button"
                  onClick={() => onSelectFeed(feed.id)}
                >
                  {selected ? "Selected" : manage ? "Manage" : "View"}
                </button>
              </div>
            </div>
          </div>
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
  const details = [catalogItem.source_name, rating ? `Rating ${rating}` : "", tags].filter(Boolean).join(" - ");

  return (
    <div className="row output-item">
      <div className="output-item-main">
        <div className="item-position">{item.position}</div>
        <div>
          <div className="title">{catalogItem.title || "Untitled"}</div>
          <div className="meta">{details}</div>
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

function describeFeed(feed: DailyFeed): string {
  return [describeFeedKind(feed.kind), describeAudience(feed.audience), describeSchedule(feed.schedule)]
    .filter(Boolean)
    .join(" - ");
}

function describeFeedKind(kind: string): string {
  if (kind === "daily_thread") {
    return "Daily thread";
  }
  return "Catalog daily";
}

function describeAudience(audience: DailyFeed["audience"] = { type: "all_members" }): string {
  if (audience.type === "division") {
    return "Division audience";
  }
  return "All members";
}

function describeSchedule(schedule: DailyFeed["schedule"] = { cadence: "daily", timezone: "UTC" }): string {
  const cadence = schedule.cadence || "daily";
  const timezone = schedule.timezone || "UTC";
  return `${cadence} in ${timezone}`;
}

function primitiveDisplay(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}
