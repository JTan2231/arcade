import type {
  CatalogSource,
  CreateDailyFeedRequest,
  CreateEvidenceFormatRequest,
  CreateFeedMetricJudgmentRequest,
  CreateFeedMetricRequest,
  CreateGroupFeedPostRequest,
  CreateGroupPostTagRequest,
  CreateGroupRequest,
  CreateEvidenceFormatVersionRequest,
  DailyFeed,
  DailyFeedOutput,
  DailyFeedOutputSummary,
  DailyFeedPreview,
  EvidenceFormat,
  FeedMetric,
  FeedMetricJudgment,
  Friend,
  FriendRequest,
  FriendRequests,
  Group,
  GroupFeedPost,
  GroupFeedPostRoute,
  GroupInvite,
  GroupInviteCandidate,
  GroupMember,
  GroupPostTag,
  LoginRequest,
  MetricLeaderboard,
  PatchFeedMetricJudgmentRequest,
  PatchFeedMetricRequest,
  PatchDailyFeedRequest,
  PatchEvidenceFormatRequest,
  PatchGroupRequest,
  PatchGroupFeedPostRequest,
  PatchGroupPostTagRequest,
  PublicFeed,
  PublicGroup,
  PublicPost,
  SignupRequest,
  User,
} from "./types";

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

export function rotateFriendCode(options: APIOptions = {}): Promise<User> {
  return api<User>("/api/me/friend-code/rotate", {
    ...options,
    method: "POST",
    body: "{}",
  });
}

export function createFriendRequest(friendCode: string, options: APIOptions = {}): Promise<FriendRequest> {
  return api<FriendRequest>("/api/friend-requests", {
    ...options,
    method: "POST",
    body: JSON.stringify({ friend_code: friendCode }),
  });
}

export function listFriendRequests(options: APIOptions = {}): Promise<FriendRequests> {
  return api<FriendRequests>("/api/friend-requests", options);
}

export function acceptFriendRequest(requestID: string, options: APIOptions = {}): Promise<FriendRequest> {
  return api<FriendRequest>(`/api/friend-requests/${encodeURIComponent(requestID)}/accept`, {
    ...options,
    method: "POST",
    body: "{}",
  });
}

export function declineFriendRequest(requestID: string, options: APIOptions = {}): Promise<FriendRequest> {
  return api<FriendRequest>(`/api/friend-requests/${encodeURIComponent(requestID)}/decline`, {
    ...options,
    method: "POST",
    body: "{}",
  });
}

export function cancelFriendRequest(requestID: string, options: APIOptions = {}): Promise<FriendRequest> {
  return api<FriendRequest>(`/api/friend-requests/${encodeURIComponent(requestID)}/cancel`, {
    ...options,
    method: "POST",
    body: "{}",
  });
}

export function listFriends(options: APIOptions = {}): Promise<Friend[]> {
  return api<Friend[]>("/api/friends", options);
}

export function deleteFriend(userID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/friends/${encodeURIComponent(userID)}`, {
    ...options,
    method: "DELETE",
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

export function listGroupInvites(options: APIOptions = {}): Promise<GroupInvite[]> {
  return api<GroupInvite[]>("/api/group-invites", options);
}

export function listGroupInviteCandidates(groupID: string, options: APIOptions = {}): Promise<GroupInviteCandidate[]> {
  return api<GroupInviteCandidate[]>(`/api/groups/${encodeURIComponent(groupID)}/invite-candidates`, options);
}

export function createGroupInvite(groupID: string, userID: string, options: APIOptions = {}): Promise<GroupInvite> {
  return api<GroupInvite>(`/api/groups/${encodeURIComponent(groupID)}/invites`, {
    ...options,
    method: "POST",
    body: JSON.stringify({ user_id: userID }),
  });
}

export function acceptGroupInvite(groupID: string, userID: string, options: APIOptions = {}): Promise<Group> {
  return api<Group>(`/api/groups/${encodeURIComponent(groupID)}/invites/${encodeURIComponent(userID)}/accept`, {
    ...options,
    method: "POST",
    body: "{}",
  });
}

export function declineGroupInvite(groupID: string, userID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}/invites/${encodeURIComponent(userID)}/decline`, {
    ...options,
    method: "POST",
    body: "{}",
  });
}

export function cancelGroupInvite(groupID: string, userID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}/invites/${encodeURIComponent(userID)}/cancel`, {
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
  return api<EvidenceFormat[]>(`/api/groups/${encodeURIComponent(groupID)}/evidence-formats${query}`, options);
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
  );
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
  );
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
  );
}

export function deleteGroupEvidenceFormat(groupID: string, formatID: string, options: APIOptions = {}): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}/evidence-formats/${encodeURIComponent(formatID)}`, {
    ...options,
    method: "DELETE",
  });
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
