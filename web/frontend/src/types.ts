export type User = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  friend_code: string;
  created_at: string;
  updated_at: string;
};

export type PublicUser = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
};

export type FriendRequest = {
  id: string;
  status: "pending" | "accepted" | "declined" | "canceled";
  requester: PublicUser;
  addressee: PublicUser;
  created_at: string;
  updated_at: string;
};

export type FriendRequests = {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
};

export type Friend = {
  user: PublicUser;
  friends_since: string;
};

export type GroupInvite = {
  group: Group;
  invited_by?: PublicUser;
  invited_at?: string;
};

export type GroupInviteCandidate = {
  user: PublicUser;
  membership_status?: "invited" | "active" | "removed" | "left";
};

export type Group = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  visibility: "public" | "invite_only" | "private";
  created_by_user_id: string;
  my_role?: "owner" | "admin" | "member";
  my_status?: "invited" | "active" | "removed" | "left";
  created_at: string;
  updated_at: string;
};

type DailyFeedSchedule = {
  starts_at: string;
  timezone: string;
  interval_seconds: number;
};

export type CatalogSourceField = {
  id: string;
  source_id: string;
  key: string;
  label: string;
  value_type: "string" | "number";
  is_array: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export type DailyFeedRuleFilter = {
  id?: string;
  feed_id?: string;
  source_id?: string;
  field_id: string;
  field_key?: string;
  field_label?: string;
  value_type?: "string" | "number";
  is_array?: boolean;
  position?: number;
  op: string;
  text_values?: string[];
  number_values?: number[];
};

export type DailyFeed = {
  id: string;
  group_id: string;
  group_name?: string;
  name: string;
  slug: string;
  kind: "catalog_daily" | "daily_thread";
  description?: string;
  enabled: boolean;
  source_id?: string;
  source_name?: string;
  item_count?: number;
  schedule: DailyFeedSchedule;
  filters: DailyFeedRuleFilter[];
  created_by_user_id?: string;
  created_at: string;
  updated_at: string;
};

type DailyCatalogItem = {
  id: string;
  source_id: string;
  source_name: string;
  title?: string;
  data: Record<string, unknown>;
};

export type DailyFeedAction = {
  type: "external_url" | "text";
  label: string;
  url?: string;
  text?: string;
};

export type DailyFeedOutputItem = {
  position: number;
  role: string;
  points: number;
  reason: string;
  item: DailyCatalogItem;
  action: DailyFeedAction;
};

export type DailyFeedOutput = {
  feed_id: string;
  group_id: string;
  group_name?: string;
  date: string;
  title: string;
  items: DailyFeedOutputItem[];
};

export type CatalogSource = {
  id: string;
  group_id?: string;
  slug: string;
  scope: "group" | "global";
  name: string;
  template: string;
  created_by_user_id?: string;
  item_count: number;
  eligible_item_count: number;
  template_fields: string[];
  fields: CatalogSourceField[];
  created_at: string;
  updated_at: string;
};

export type DailyFeedPreview = {
  output: DailyFeedOutput;
  candidate_item_count: number;
  eligible_item_count: number;
  ineligible_item_count: number;
  ineligible_items: Array<{
    id: string;
    source_id: string;
    title?: string;
    missing_fields: string[];
  }>;
};

export type CreateDailyFeedRequest = {
  name: string;
  kind: "catalog_daily" | "daily_thread";
  description?: string;
  enabled: boolean;
  source_id?: string;
  item_count?: number;
  schedule: DailyFeedSchedule;
  filters?: DailyFeedRuleFilter[];
};

export type GroupFeedPost = {
  id: string;
  group_id: string;
  feed_instance_id: string;
  feed_id: string;
  feed_date: string;
  author_user_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar_url?: string;
  evidence_kind: "text";
  evidence_text: string;
  caption?: string;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
};

export type CreateGroupFeedPostRequest = {
  evidence_kind: "text";
  evidence_text: string;
  caption?: string;
};

export type PatchGroupFeedPostRequest = {
  evidence_kind?: "text";
  evidence_text?: string;
  caption?: string | null;
};

export type FeedMetricKey =
  | "judged"
  | "post_count"
  | "average_post_length_words"
  | "missed_days"
  | "current_streak"
  | "typical_posting_window";

export type SystemMetricKey = Exclude<FeedMetricKey, "judged">;

export type MetricAggregation = "sum" | "average" | "latest" | "count" | "max" | "min";

export type FeedMetric = {
  id: string;
  group_id: string;
  feed_id: string;
  system_key: FeedMetricKey;
  judgment_prompt?: string;
  aggregation: MetricAggregation;
  display_name: string;
  created_by_user_id?: string;
  created_at: string;
  updated_at: string;
};

export type FeedMetricJudgment = {
  id: string;
  metric_id: string;
  group_id: string;
  post_id: string;
  subject_user_id: string;
  evaluator_user_id: string;
  value: number;
  note?: string;
  created_at: string;
  updated_at: string;
};

export type MetricLeaderboard = {
  metric: FeedMetric;
  from: string;
  to: string;
  rows: MetricLeaderboardRow[];
};

export type MetricLeaderboardRow = {
  rank: number | null;
  user: PublicUser;
  value: number | string;
  raw_value: number | null;
  sample_count: number;
};

export type CreateFeedMetricRequest = {
  system_key: FeedMetricKey;
  judgment_prompt?: string;
  aggregation: MetricAggregation;
  display_name: string;
};

export type PatchFeedMetricRequest = {
  judgment_prompt?: string;
  aggregation?: MetricAggregation;
  display_name?: string;
};

export type CreateFeedMetricJudgmentRequest = {
  post_id: string;
  value: number;
  note?: string;
};

export type PatchFeedMetricJudgmentRequest = {
  value?: number;
  note?: string | null;
};

export type LoginRequest = {
  email: string;
  password: string;
  remember_me: boolean;
};

export type SignupRequest = {
  email: string;
  password: string;
  display_name: string;
  remember_me: boolean;
};

export type CreateGroupRequest = {
  name: string;
};
