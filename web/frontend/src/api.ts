import type {
  CatalogSource,
  CreateDailyFeedRequest,
  CreateGroupFeedPostRequest,
  CreateGroupRequest,
  DailyFeed,
  DailyFeedOutput,
  DailyFeedPreview,
  Group,
  GroupFeedPost,
  LoginRequest,
  PatchGroupFeedPostRequest,
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

export function listGroupDailyFeeds(groupID: string, options: APIOptions = {}): Promise<DailyFeed[]> {
  return api<DailyFeed[]>(`/api/groups/${encodeURIComponent(groupID)}/daily-feeds`, options);
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

export function updateGroupDailyFeed(
  groupID: string,
  feedID: string,
  payload: Partial<Pick<DailyFeed, "enabled">>,
  options: APIOptions = {},
): Promise<DailyFeed> {
  return api<DailyFeed>(`/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
