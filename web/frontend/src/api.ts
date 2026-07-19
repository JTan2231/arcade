import type {
  CatalogSource,
  CreateEvidenceFormatVersionRequest,
  CreateDailyFeedRequest,
  CreateEvidenceFormatRequest,
  CreateFeedMetricJudgmentRequest,
  CreateFeedMetricRequest,
  CreateGroupFeedPostRequest,
  CreateGroupInviteLinkRequest,
  CreatePostCardPaletteRequest,
  CreateGroupPostTagRequest,
  CreateGroupRequest,
  CyclePreview,
  CycleSettings,
  DailyFeed,
  DailyFeedCycle,
  DailyFeedEvent,
  DailyFeedEventPreview,
  DailyFeedOutput,
  DailyFeedOutputSummary,
  DailyFeedPreview,
  EvidenceFormat,
  FeedMetric,
  FeedMetricJudgment,
  Group,
  GroupFeedPost,
  GroupFeedPostRoute,
  GroupInviteLink,
  GroupInviteLinkPreview,
  GroupMember,
  GroupPostTag,
  LoginRequest,
  MetricLeaderboard,
  PatchFeedMetricJudgmentRequest,
  PatchFeedMetricRequest,
  PatchDailyFeedEventRequest,
  PatchDailyFeedRequest,
  PatchEvidenceFormatRequest,
  PatchGroupRequest,
  PatchGroupFeedPostRequest,
  PatchGroupPostTagRequest,
  PatchPostCardPaletteRequest,
  PostCardPalette,
  PublicFeed,
  PublicGroup,
  PublicPost,
  SignupRequest,
  UpsertCycleSettingsRequest,
  UpsertDailyFeedEventRequest,
  User,
} from "./types";
import { publishPostFormatAppearance, publishPostFormatAppearances } from "./postFormatAppearances";

type APIErrorBody = {
  error?: string;
};

type APIOptions = {
  signal?: AbortSignal;
};

class APIError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof APIError && error.status === 401;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof APIError && error.status === 404;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { headers, ...fetchOptions } = options;
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    ...fetchOptions,
  });

  if (response.status === 204) {
    return null as T;
  }

  const body = (await response.json().catch(() => ({}))) as APIErrorBody | T;

  if (!response.ok) {
    const apiError = (body as APIErrorBody).error;
    const message = typeof apiError === "string" ? apiError : `Request failed: ${response.status}`;
    throw new APIError(message, response.status);
  }

  return body as T;
}

export function getSession(options: APIOptions = {}): Promise<User> {
  return api<User>("/api/auth/session", options);
}

export function login(payload: LoginRequest, options: APIOptions = {}): Promise<User> {
  return api<User>("/api/auth/login", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function signup(payload: SignupRequest, options: APIOptions = {}): Promise<User> {
  return api<User>("/api/auth/signup", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logout(options: APIOptions = {}): Promise<null> {
  return api<null>("/api/auth/logout", {
    ...options,
    method: "POST",
    body: "{}",
  });
}

export function updateThemePreference(
  themePreference: User["theme_preference"],
  options: APIOptions = {},
): Promise<User> {
  return api<User>("/api/me", {
    ...options,
    method: "PATCH",
    body: JSON.stringify({ theme_preference: themePreference }),
  });
}

export function listGroups(options: APIOptions = {}): Promise<Group[]> {
  return api<Group[]>("/api/groups", options);
}

export function createGroup(payload: CreateGroupRequest, options: APIOptions = {}): Promise<Group> {
  return api<Group>("/api/groups", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateGroup(groupID: string, payload: PatchGroupRequest, options: APIOptions = {}): Promise<Group> {
  return api<Group>(`/api/groups/${encodeURIComponent(groupID)}`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function joinGroup(groupID: string, options: APIOptions = {}): Promise<Group> {
  return api<Group>(`/api/groups/${encodeURIComponent(groupID)}/join`, {
    ...options,
    method: "POST",
    body: "{}",
  });
}

export function deleteGroup(groupID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}`, {
    ...options,
    method: "DELETE",
  });
}

export function listGroupMembers(groupID: string, options: APIOptions = {}): Promise<GroupMember[]> {
  return api<GroupMember[]>(`/api/groups/${encodeURIComponent(groupID)}/members`, options);
}

export function deleteGroupMember(groupID: string, userID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}/members/${encodeURIComponent(userID)}`, {
    ...options,
    method: "DELETE",
  });
}

export function listGroupInviteLinks(groupID: string, options: APIOptions = {}): Promise<GroupInviteLink[]> {
  return api<GroupInviteLink[]>(`/api/groups/${encodeURIComponent(groupID)}/invite-links`, options);
}

export function createGroupInviteLink(
  groupID: string,
  payload: CreateGroupInviteLinkRequest,
  options: APIOptions = {},
): Promise<GroupInviteLink> {
  return api<GroupInviteLink>(`/api/groups/${encodeURIComponent(groupID)}/invite-links`, {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function revokeGroupInviteLink(groupID: string, linkID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}/invite-links/${encodeURIComponent(linkID)}`, {
    ...options,
    method: "DELETE",
  });
}

export function getInviteLinkPreview(token: string, options: APIOptions = {}): Promise<GroupInviteLinkPreview> {
  return api<GroupInviteLinkPreview>(`/api/invite-links/${encodeURIComponent(token)}`, options);
}

export function acceptInviteLink(token: string, options: APIOptions = {}): Promise<Group> {
  return api<Group>(`/api/invite-links/${encodeURIComponent(token)}/accept`, {
    ...options,
    method: "POST",
    body: "{}",
  });
}

export function listGroupDailyFeeds(groupID: string, options: APIOptions = {}): Promise<DailyFeed[]> {
  return api<DailyFeed[]>(`/api/groups/${encodeURIComponent(groupID)}/daily-feeds`, options);
}

export function listMeDailyFeeds(options: APIOptions = {}): Promise<DailyFeed[]> {
  return api<DailyFeed[]>("/api/me/daily-feeds", options);
}

export function listGroupCatalogSources(groupID: string, options: APIOptions = {}): Promise<CatalogSource[]> {
  return api<CatalogSource[]>(`/api/groups/${encodeURIComponent(groupID)}/catalog-sources`, options);
}

export function createGroupDailyFeed(
  groupID: string,
  payload: CreateDailyFeedRequest,
  options: APIOptions = {},
): Promise<DailyFeed> {
  return api<DailyFeed>(`/api/groups/${encodeURIComponent(groupID)}/daily-feeds`, {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function previewGroupDailyFeed(
  groupID: string,
  payload: CreateDailyFeedRequest,
  options: APIOptions = {},
): Promise<DailyFeedPreview> {
  return api<DailyFeedPreview>(`/api/groups/${encodeURIComponent(groupID)}/daily-feeds/preview`, {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listGroupDailyFeedEvents(
  groupID: string,
  feedID: string,
  options: APIOptions = {},
): Promise<DailyFeedEvent[]> {
  return api<DailyFeedEvent[]>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/events`,
    options,
  );
}

export function previewGroupDailyFeedEvent(
  groupID: string,
  feedID: string,
  payload: UpsertDailyFeedEventRequest,
  options: APIOptions = {},
): Promise<DailyFeedEventPreview> {
  return api<DailyFeedEventPreview>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/events/preview`,
    {
      ...options,
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function createGroupDailyFeedEvent(
  groupID: string,
  feedID: string,
  payload: UpsertDailyFeedEventRequest,
  options: APIOptions = {},
): Promise<DailyFeedEvent> {
  return api<DailyFeedEvent>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/events`,
    {
      ...options,
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function updateGroupDailyFeedEvent(
  groupID: string,
  feedID: string,
  eventID: string,
  payload: PatchDailyFeedEventRequest,
  options: APIOptions = {},
): Promise<DailyFeedEvent> {
  return api<DailyFeedEvent>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/events/${encodeURIComponent(eventID)}`,
    {
      ...options,
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteGroupDailyFeedEvent(
  groupID: string,
  feedID: string,
  eventID: string,
  options: APIOptions = {},
): Promise<null> {
  return api<null>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/events/${encodeURIComponent(eventID)}`,
    {
      ...options,
      method: "DELETE",
    },
  );
}

export async function getGroupDailyFeedCycleSettings(
  groupID: string,
  feedID: string,
  options: APIOptions = {},
): Promise<CycleSettings | null> {
  try {
    return await api<CycleSettings>(
      `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/cycle-settings`,
      options,
    );
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export function previewGroupDailyFeedCycleSettings(
  groupID: string,
  feedID: string,
  payload: UpsertCycleSettingsRequest,
  options: APIOptions = {},
): Promise<CyclePreview> {
  return api<CyclePreview>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/cycle-settings/preview`,
    {
      ...options,
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function replaceGroupDailyFeedCycleSettings(
  groupID: string,
  feedID: string,
  payload: UpsertCycleSettingsRequest,
  options: APIOptions = {},
): Promise<CycleSettings> {
  return api<CycleSettings>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/cycle-settings`,
    {
      ...options,
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteGroupDailyFeedCycleSettings(
  groupID: string,
  feedID: string,
  options: APIOptions = {},
): Promise<null> {
  return api<null>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/cycle-settings`,
    {
      ...options,
      method: "DELETE",
    },
  );
}

export async function listGroupDailyFeedCycles(
  groupID: string,
  feedID: string,
  options: APIOptions = {},
): Promise<DailyFeedCycle[]> {
  try {
    return await api<DailyFeedCycle[]>(
      `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/cycles`,
      options,
    );
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export function refreshGroupDailyFeedCycle(
  groupID: string,
  feedID: string,
  cycleID: string,
  options: APIOptions = {},
): Promise<DailyFeedCycle> {
  return api<DailyFeedCycle>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/cycles/${encodeURIComponent(cycleID)}/refresh`,
    {
      ...options,
      method: "POST",
      body: "{}",
    },
  );
}

export function getGroupDailyFeedToday(
  groupID: string,
  feedID: string,
  options: APIOptions = {},
): Promise<DailyFeedOutput> {
  return api<DailyFeedOutput>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/today`,
    options,
  );
}

export function refreshGroupDailyFeedToday(
  groupID: string,
  feedID: string,
  options: APIOptions = {},
): Promise<DailyFeedOutput> {
  return api<DailyFeedOutput>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/today/refresh`,
    {
      ...options,
      method: "POST",
      body: "{}",
    },
  );
}

export function getGroupDailyFeedOutput(
  groupID: string,
  feedID: string,
  date: string,
  options: APIOptions = {},
): Promise<DailyFeedOutput> {
  return api<DailyFeedOutput>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/outputs/${encodeURIComponent(date)}`,
    options,
  );
}

export function listGroupDailyFeedOutputSummaries(
  groupID: string,
  feedID: string,
  selectedDate: string,
  options: APIOptions = {},
): Promise<DailyFeedOutputSummary[]> {
  const params = selectedDate !== "" ? `?selected_date=${encodeURIComponent(selectedDate)}` : "";
  return api<DailyFeedOutputSummary[]>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/outputs${params}`,
    options,
  );
}

export function listGroupFeedPosts(
  groupID: string,
  feedID: string,
  date: string,
  options: APIOptions = {},
): Promise<GroupFeedPost[]> {
  return api<GroupFeedPost[]>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/outputs/${encodeURIComponent(date)}/posts`,
    options,
  );
}

export function listGroupPostTags(
  groupID: string,
  params: { includeArchived?: boolean } = {},
  options: APIOptions = {},
): Promise<GroupPostTag[]> {
  const query = params.includeArchived === true ? "?include_archived=true" : "";
  return api<GroupPostTag[]>(`/api/groups/${encodeURIComponent(groupID)}/post-tags${query}`, options);
}

export function listGroupEvidenceFormats(
  groupID: string,
  params: { includeArchived?: boolean } = {},
  options: APIOptions = {},
): Promise<EvidenceFormat[]> {
  const query = params.includeArchived === true ? "?include_archived=true" : "";
  return api<EvidenceFormat[]>(`/api/groups/${encodeURIComponent(groupID)}/evidence-formats${query}`, options).then(
    (formats) => {
      publishPostFormatAppearances(formats);
      return formats;
    },
  );
}

export function createGroupEvidenceFormat(
  groupID: string,
  payload: CreateEvidenceFormatRequest,
  options: APIOptions = {},
): Promise<EvidenceFormat> {
  return api<EvidenceFormat>(`/api/groups/${encodeURIComponent(groupID)}/evidence-formats`, {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  }).then((format) => {
    publishPostFormatAppearance(format);
    return format;
  });
}

export function getGroupEvidenceFormat(
  groupID: string,
  formatID: string,
  options: APIOptions = {},
): Promise<EvidenceFormat> {
  return api<EvidenceFormat>(
    `/api/groups/${encodeURIComponent(groupID)}/evidence-formats/${encodeURIComponent(formatID)}`,
    options,
  ).then((format) => {
    publishPostFormatAppearance(format);
    return format;
  });
}

export function updateGroupEvidenceFormat(
  groupID: string,
  formatID: string,
  payload: PatchEvidenceFormatRequest,
  options: APIOptions = {},
): Promise<EvidenceFormat> {
  return api<EvidenceFormat>(
    `/api/groups/${encodeURIComponent(groupID)}/evidence-formats/${encodeURIComponent(formatID)}`,
    {
      ...options,
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  ).then((format) => {
    publishPostFormatAppearance(format);
    return format;
  });
}

export function createGroupEvidenceFormatVersion(
  groupID: string,
  formatID: string,
  payload: CreateEvidenceFormatVersionRequest,
  options: APIOptions = {},
): Promise<EvidenceFormat> {
  return api<EvidenceFormat>(
    `/api/groups/${encodeURIComponent(groupID)}/evidence-formats/${encodeURIComponent(formatID)}/versions`,
    {
      ...options,
      method: "POST",
      body: JSON.stringify(payload),
    },
  ).then((format) => {
    publishPostFormatAppearance(format);
    return format;
  });
}

export function deleteGroupEvidenceFormat(groupID: string, formatID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}/evidence-formats/${encodeURIComponent(formatID)}`, {
    ...options,
    method: "DELETE",
  });
}

export function listGroupPostCardPalettes(
  groupID: string,
  params: { includeArchived?: boolean } = {},
  options: APIOptions = {},
): Promise<PostCardPalette[]> {
  const query = params.includeArchived === true ? "?include_archived=true" : "";
  return api<PostCardPalette[]>(`/api/groups/${encodeURIComponent(groupID)}/post-card-palettes${query}`, options);
}

export function createGroupPostCardPalette(
  groupID: string,
  payload: CreatePostCardPaletteRequest,
  options: APIOptions = {},
): Promise<PostCardPalette> {
  return api<PostCardPalette>(`/api/groups/${encodeURIComponent(groupID)}/post-card-palettes`, {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateGroupPostCardPalette(
  groupID: string,
  paletteID: string,
  payload: PatchPostCardPaletteRequest,
  options: APIOptions = {},
): Promise<PostCardPalette> {
  return api<PostCardPalette>(
    `/api/groups/${encodeURIComponent(groupID)}/post-card-palettes/${encodeURIComponent(paletteID)}`,
    {
      ...options,
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function createGroupPostTag(
  groupID: string,
  payload: CreateGroupPostTagRequest,
  options: APIOptions = {},
): Promise<GroupPostTag> {
  return api<GroupPostTag>(`/api/groups/${encodeURIComponent(groupID)}/post-tags`, {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getGroupPostTag(groupID: string, tagID: string, options: APIOptions = {}): Promise<GroupPostTag> {
  return api<GroupPostTag>(
    `/api/groups/${encodeURIComponent(groupID)}/post-tags/${encodeURIComponent(tagID)}`,
    options,
  );
}

export function updateGroupPostTag(
  groupID: string,
  tagID: string,
  payload: PatchGroupPostTagRequest,
  options: APIOptions = {},
): Promise<GroupPostTag> {
  return api<GroupPostTag>(`/api/groups/${encodeURIComponent(groupID)}/post-tags/${encodeURIComponent(tagID)}`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteGroupPostTag(groupID: string, tagID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}/post-tags/${encodeURIComponent(tagID)}`, {
    ...options,
    method: "DELETE",
  });
}

export function createGroupFeedPost(
  groupID: string,
  feedID: string,
  date: string,
  payload: CreateGroupFeedPostRequest,
  options: APIOptions = {},
): Promise<GroupFeedPost> {
  return api<GroupFeedPost>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/outputs/${encodeURIComponent(date)}/posts`,
    {
      ...options,
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function updateGroupFeedPost(
  groupID: string,
  postID: string,
  payload: PatchGroupFeedPostRequest,
  options: APIOptions = {},
): Promise<GroupFeedPost> {
  return api<GroupFeedPost>(`/api/groups/${encodeURIComponent(groupID)}/feed-posts/${encodeURIComponent(postID)}`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteGroupFeedPost(groupID: string, postID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}/feed-posts/${encodeURIComponent(postID)}`, {
    ...options,
    method: "DELETE",
  });
}

export function getMemberFeedPostRoute(postID: string, options: APIOptions = {}): Promise<GroupFeedPostRoute> {
  return api<GroupFeedPostRoute>(`/api/me/feed-posts/${encodeURIComponent(postID)}/route`, options);
}

export function listFeedMetrics(groupID: string, feedID: string, options: APIOptions = {}): Promise<FeedMetric[]> {
  return api<FeedMetric[]>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/metrics`,
    options,
  );
}

export function createFeedMetric(
  groupID: string,
  feedID: string,
  payload: CreateFeedMetricRequest,
  options: APIOptions = {},
): Promise<FeedMetric> {
  return api<FeedMetric>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/metrics`,
    {
      ...options,
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function getFeedMetric(
  groupID: string,
  feedID: string,
  metricID: string,
  options: APIOptions = {},
): Promise<FeedMetric> {
  return api<FeedMetric>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/metrics/${encodeURIComponent(metricID)}`,
    options,
  );
}

export function updateFeedMetric(
  groupID: string,
  feedID: string,
  metricID: string,
  payload: PatchFeedMetricRequest,
  options: APIOptions = {},
): Promise<FeedMetric> {
  return api<FeedMetric>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/metrics/${encodeURIComponent(metricID)}`,
    {
      ...options,
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteFeedMetric(
  groupID: string,
  feedID: string,
  metricID: string,
  options: APIOptions = {},
): Promise<null> {
  return api<null>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/metrics/${encodeURIComponent(metricID)}`,
    {
      ...options,
      method: "DELETE",
    },
  );
}

export function getMetricLeaderboard(
  groupID: string,
  feedID: string,
  metricID: string,
  options: APIOptions = {},
): Promise<MetricLeaderboard> {
  return api<MetricLeaderboard>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/metrics/${encodeURIComponent(metricID)}/leaderboard`,
    options,
  );
}

export function createFeedMetricJudgment(
  groupID: string,
  feedID: string,
  metricID: string,
  payload: CreateFeedMetricJudgmentRequest,
  options: APIOptions = {},
): Promise<FeedMetricJudgment> {
  return api<FeedMetricJudgment>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/metrics/${encodeURIComponent(metricID)}/judgments`,
    {
      ...options,
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function updateFeedMetricJudgment(
  groupID: string,
  judgmentID: string,
  payload: PatchFeedMetricJudgmentRequest,
  options: APIOptions = {},
): Promise<FeedMetricJudgment> {
  return api<FeedMetricJudgment>(
    `/api/groups/${encodeURIComponent(groupID)}/metric-judgments/${encodeURIComponent(judgmentID)}`,
    {
      ...options,
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteFeedMetricJudgment(groupID: string, judgmentID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}/metric-judgments/${encodeURIComponent(judgmentID)}`, {
    ...options,
    method: "DELETE",
  });
}

export function updateGroupDailyFeed(
  groupID: string,
  feedID: string,
  payload: PatchDailyFeedRequest,
  options: APIOptions = {},
): Promise<DailyFeed> {
  return api<DailyFeed>(`/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteGroupDailyFeed(groupID: string, feedID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}`, {
    ...options,
    method: "DELETE",
  });
}

export function getPublicGroup(slug: string, options: APIOptions = {}): Promise<PublicGroup> {
  return api<PublicGroup>(`/api/public/groups/${encodeURIComponent(slug)}`, options);
}

export function getPublicFeed(feedID: string, options: APIOptions = {}): Promise<PublicFeed> {
  return api<PublicFeed>(`/api/public/feeds/${encodeURIComponent(feedID)}`, options);
}

export function getPublicFeedOutput(feedID: string, date: string, options: APIOptions = {}): Promise<PublicFeed> {
  return api<PublicFeed>(
    `/api/public/feeds/${encodeURIComponent(feedID)}/outputs/${encodeURIComponent(date)}`,
    options,
  );
}

export function listPublicFeedOutputSummaries(
  feedID: string,
  selectedDate: string,
  options: APIOptions = {},
): Promise<DailyFeedOutputSummary[]> {
  const params = selectedDate !== "" ? `?selected_date=${encodeURIComponent(selectedDate)}` : "";
  return api<DailyFeedOutputSummary[]>(`/api/public/feeds/${encodeURIComponent(feedID)}/outputs${params}`, options);
}

export function getPublicPost(postID: string, options: APIOptions = {}): Promise<PublicPost> {
  return api<PublicPost>(`/api/public/posts/${encodeURIComponent(postID)}`, options);
}
