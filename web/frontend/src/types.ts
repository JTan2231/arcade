export type ThemePreference = "system" | "dark" | "light";

export type User = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  theme_preference: ThemePreference;
  created_at: string;
  updated_at: string;
};

export type PublicUser = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
};

export type Group = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  visibility: Visibility;
  join_policy: JoinPolicy;
  created_by_user_id: string;
  my_role?: "owner" | "admin" | "member";
  my_status?: "active" | "removed" | "left";
  created_at: string;
  updated_at: string;
};

export type Visibility = "public" | "private";

export type JoinPolicy = "invite_only" | "open";

export type PublicGroup = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  visibility: "public";
  join_policy: JoinPolicy;
  feeds: PublicGroupFeed[];
  created_at: string;
  updated_at: string;
};

export type PublicGroupFeed = {
  id: string;
  name: string;
  slug: string;
  kind: "catalog_daily" | "daily_thread";
  description?: string;
  enabled: boolean;
  captions_enabled: boolean;
  evidence_format: EvidenceFormat;
  schedule: DailyFeedSchedule;
  created_at: string;
  updated_at: string;
};

type PublicParentGroup = {
  id: string;
  name: string;
  slug: string;
  visibility: Visibility;
  join_policy: JoinPolicy;
};

export type GroupMember = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  role: "owner" | "admin" | "member";
  status: "active" | "removed" | "left";
  joined_at?: string;
  invited_by?: PublicUser;
  invited_at?: string;
  invite_link?: GroupInviteLinkSummary;
  created_at: string;
  updated_at: string;
};

type GroupInviteLinkSummary = {
  id: string;
  label?: string;
};

export type GroupInviteLink = {
  id: string;
  group_id: string;
  label?: string;
  created_by?: PublicUser;
  expires_at: string;
  revoked_at?: string;
  max_uses?: number;
  use_count: number;
  token?: string;
  url_path?: string;
  created_at: string;
  updated_at: string;
};

export type GroupInviteLinkPreview = {
  group: PublicParentGroup;
  created_by?: PublicUser;
  expires_at: string;
  revoked_at?: string;
  max_uses?: number;
  use_count: number;
};

export type CreateGroupInviteLinkRequest = {
  label?: string;
  expires_at?: string;
  max_uses?: number;
};

export type DailyFeedSchedule = {
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

type DailyFeedEventProvenance = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
};

export type DailyFeedEvent = DailyFeedEventProvenance & {
  group_id: string;
  feed_id: string;
  description?: string;
  source_id: string;
  source_name: string;
  item_count: number;
  filters: DailyFeedRuleFilter[];
  selection_token: string;
  status: "upcoming" | "active" | "ended";
  created_by_user_id?: string;
  updated_by_user_id?: string;
  created_at: string;
  updated_at: string;
};

export type UpsertDailyFeedEventRequest = {
  name: string;
  description?: string;
  starts_on: string;
  ends_on: string;
  source_id?: string;
  item_count: number;
  filters: DailyFeedRuleFilter[];
  selection_token?: string;
};

export type PatchDailyFeedEventRequest = Omit<Partial<UpsertDailyFeedEventRequest>, "description"> & {
  description?: string | null;
};

type CycleConfigurationField = {
  field_id: string;
  field_key?: string;
  field_label?: string;
  value_type?: "string" | "number";
  is_array?: boolean;
};

type CycleConfigurationDistinct = { kind: "none" } | ({ kind: "field" } & CycleConfigurationField);

type CycleConfigurationOrder =
  | { kind: "seeded_shuffle" }
  | ({ kind: "field"; direction: "asc" | "desc" } & CycleConfigurationField);

export type CycleConfiguration = {
  id?: string;
  key: string;
  name: string;
  description?: string;
  position?: number;
  filters: DailyFeedRuleFilter[];
  distinct: CycleConfigurationDistinct;
  order: CycleConfigurationOrder;
};

export type UpsertCycleSettingsRequest = {
  starts_on: string;
  output_count: number;
  selection_token?: string;
  configurations: CycleConfiguration[];
};

export type CycleSettings = Omit<UpsertCycleSettingsRequest, "selection_token"> & {
  id: string;
  group_id: string;
  feed_id: string;
  status: "scheduled" | "active" | "ending";
  effective_starts_on: string;
  next_cycle_starts_on?: string;
  ends_before?: string;
  created_at: string;
  updated_at: string;
};

type CycleConfigurationSummary = {
  filters: string[];
  distinct: string;
  order: string;
};

type CycleProvenance = {
  id: string;
  name: string;
  configuration_key: string;
  starts_on: string;
  ends_on: string;
  position: number;
  position_count: number;
  summary: CycleConfigurationSummary;
};

export type DailyFeedCycleSettingsSummary = {
  id: string;
  starts_on: string;
  ends_before?: string;
  status: "scheduled" | "active" | "ending" | "ended";
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
  captions_enabled: boolean;
  source_id?: string;
  source_name?: string;
  item_count?: number;
  evidence_format: EvidenceFormat;
  schedule: DailyFeedSchedule;
  filters: DailyFeedRuleFilter[];
  cycle_settings?: DailyFeedCycleSettingsSummary;
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

type DailyFeedAction = {
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
  event?: DailyFeedEventProvenance;
  cycle?: CycleProvenance;
  items: DailyFeedOutputItem[];
};

export type DailyFeedOutputSummary = {
  feed_id: string;
  date: string;
  title: string;
  subtitle?: string;
  event?: DailyFeedEventProvenance;
  cycle?: CycleProvenance;
};

type PublicFeedAction = {
  type: "link" | "text";
  label: string;
  url?: string;
  text?: string;
};

export type PublicFeedOutputItem = {
  position: number;
  title: string;
  action: PublicFeedAction;
};

type PublicPostTag = {
  id: string;
  name: string;
};

export type PublicPost = {
  id: string;
  group: PublicParentGroup;
  feed: {
    id: string;
    name: string;
  };
  feed_date: string;
  author: PublicUser;
  evidence_text: string;
  evidence_format: EvidenceFormat;
  evidence_format_version: EvidenceFormatVersion;
  caption?: string;
  tags: PublicPostTag[];
  created_at: string;
  updated_at: string;
};

export type PublicFeed = {
  id: string;
  group: PublicParentGroup;
  name: string;
  slug: string;
  kind: "catalog_daily" | "daily_thread";
  description?: string;
  enabled: boolean;
  captions_enabled: boolean;
  evidence_format: EvidenceFormat;
  schedule: DailyFeedSchedule;
  date: string;
  event?: DailyFeedEventProvenance;
  cycle?: CycleProvenance;
  items: PublicFeedOutputItem[];
  posts: PublicPost[];
  created_at: string;
  updated_at: string;
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

export type DailyFeedEventPreview = DailyFeedPreview & {
  selection_token: string;
  event: DailyFeedEvent;
};

export type CyclePreview = {
  selection_token: string;
  cycle: {
    starts_on: string;
    ends_on: string;
    configuration_key: string;
    name: string;
    position_count: number;
  };
  counts: {
    candidate_item_count: number;
    matching_item_count: number;
    distinct_value_count?: number;
    requested_item_count: number;
    selected_item_count: number;
  };
  outputs: DailyFeedOutput[];
};

export type DailyFeedCycle = {
  id: string;
  group_id: string;
  feed_id: string;
  configuration_key: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: "upcoming" | "active" | "ended";
  generation: number;
  position_count: number;
  summary: CycleConfigurationSummary;
  items: Array<{
    position: number;
    date: string;
    item: DailyCatalogItem;
    action: DailyFeedAction;
  }>;
};

export type CreateDailyFeedRequest = {
  name: string;
  kind: "catalog_daily" | "daily_thread";
  description?: string;
  enabled: boolean;
  captions_enabled: boolean;
  source_id?: string;
  item_count?: number;
  evidence_format_id?: string;
  schedule: DailyFeedSchedule;
  filters?: DailyFeedRuleFilter[];
};

export type PatchDailyFeedRequest = {
  enabled?: boolean;
  captions_enabled?: boolean;
  evidence_format_id?: string;
  schedule?: DailyFeedSchedule;
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
  evidence_text: string;
  evidence_format: EvidenceFormat;
  evidence_format_version: EvidenceFormatVersion;
  caption?: string;
  tags: GroupPostTag[];
  deleted_at?: string;
  created_at: string;
  updated_at: string;
};

export type GroupFeedPostRoute = {
  group_id: string;
  feed_id: string;
  feed_date: string;
};

export type GroupPostTag = {
  id: string;
  group_id: string;
  name: string;
  display_order: number;
  archived_at?: string;
  created_by_user_id?: string;
  updated_by_user_id?: string;
  created_at: string;
  updated_at: string;
};

export type CreateGroupFeedPostRequest = {
  evidence_text: string;
  caption?: string;
  tag_ids?: string[];
};

export type PatchGroupFeedPostRequest = {
  evidence_text?: string;
  caption?: string | null;
  tag_ids?: string[];
};

export type CreateGroupPostTagRequest = {
  name: string;
  display_order?: number;
};

export type PatchGroupPostTagRequest = {
  name?: string;
  display_order?: number;
  archived?: boolean;
};

export type EvidenceFormatVersion = {
  id: string;
  group_id?: string;
  format_id: string;
  version_number: number;
  min_chars: number;
  max_chars?: number;
  min_lines?: number;
  max_lines?: number;
  exact_lines?: number;
  line_min_chars?: number;
  line_max_chars?: number;
  allow_blank_lines: boolean;
  created_by_user_id?: string;
  created_at: string;
};

export type PostContentTypeface = "monospace" | "serif";

export type PostCardPaletteMaterialIntent = {
  model: "arcade-pigment-v1";
  surface_hue: number;
  surface_colorfulness: number;
} & ({ accent_hue: number; accent_colorfulness: number } | { accent_hue?: never; accent_colorfulness?: never });

export type PostCardPaletteSummary = {
  id: string;
  system_key?: string;
  name: string;
  material_intent: PostCardPaletteMaterialIntent;
  archived_at?: string;
  revision: number;
};

export type PostCardPalette = PostCardPaletteSummary & {
  group_id: string;
  active_format_count: number;
  archived_format_count: number;
  created_by_user_id?: string;
  updated_by_user_id?: string;
  created_at: string;
  updated_at: string;
};

export type CreatePostCardPaletteRequest = {
  name: string;
  material_intent: PostCardPaletteMaterialIntent;
};

export type PatchPostCardPaletteRequest = {
  expected_revision: number;
  name?: string;
  material_intent?: PostCardPaletteMaterialIntent;
  archived?: boolean;
};

export type EvidenceFormat = {
  id: string;
  group_id?: string;
  slug: string;
  name: string;
  description?: string;
  content_typeface: PostContentTypeface;
  content_card_palette_id: string;
  content_card_palette: PostCardPaletteSummary;
  archived_at?: string;
  active_version: EvidenceFormatVersion;
  assigned_feed_count: number;
  created_by_user_id?: string;
  updated_by_user_id?: string;
  created_at: string;
  updated_at: string;
};

export type CreateEvidenceFormatRequest = {
  slug: string;
  name: string;
  description?: string;
  content_typeface: PostContentTypeface;
  content_card_palette_id: string;
  min_chars?: number;
  max_chars?: number;
  min_lines?: number;
  max_lines?: number;
  exact_lines?: number;
  line_min_chars?: number;
  line_max_chars?: number;
  allow_blank_lines?: boolean;
};

export type CreateEvidenceFormatVersionRequest = {
  min_chars?: number;
  max_chars?: number;
  min_lines?: number;
  max_lines?: number;
  exact_lines?: number;
  line_min_chars?: number;
  line_max_chars?: number;
  allow_blank_lines?: boolean;
};

export type PatchEvidenceFormatRequest = {
  name?: string;
  description?: string | null;
  content_typeface?: PostContentTypeface;
  content_card_palette_id?: string;
  archived?: boolean;
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

export type PatchGroupRequest = {
  name?: string;
  slug?: string;
  description?: string | null;
  visibility?: Visibility;
  join_policy?: JoinPolicy;
};

export type PublicRoute =
  | {
      kind: "group";
      slug: string;
    }
  | {
      kind: "feed";
      feedId: string;
      date: string | null;
    }
  | {
      kind: "post";
      postId: string;
    };
