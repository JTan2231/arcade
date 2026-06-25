export type User = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
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

export type DailyFeedAudience = {
  type: "all_members" | "division" | string;
  division_id?: string;
};

export type DailyFeedSchedule = {
  cadence: "daily" | string;
  timezone: string;
};

export type DailyFeedRatingFilter = {
  min?: number;
  max?: number;
  target?: number;
};

export type DailyFeedTagFilter = {
  include_any?: string[];
  exclude_any?: string[];
};

export type DailyFeedFilters = {
  rating?: DailyFeedRatingFilter;
  tags?: DailyFeedTagFilter;
};

export type DailyFeedRuleBlock = {
  source_id: string;
  source?: string;
  kind?: string;
  count: number;
  filters?: DailyFeedFilters;
  roles?: string[];
  points?: number[];
};

export type DailyFeedRules = {
  blocks: DailyFeedRuleBlock[];
};

export type DailyFeed = {
  id: string;
  group_id: string;
  group_name?: string;
  name: string;
  slug: string;
  kind: "catalog_daily" | "daily_thread" | string;
  description?: string;
  enabled: boolean;
  audience: DailyFeedAudience;
  schedule: DailyFeedSchedule;
  rules_schema_version: number;
  rules: DailyFeedRules;
  created_by_user_id?: string;
  created_at: string;
  updated_at: string;
};

export type DailyCatalogItem = {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  data: Record<string, unknown>;
};

export type DailyFeedAction = {
  type: "external_url" | "text" | string;
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
  evidence_kind: "text" | string;
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
