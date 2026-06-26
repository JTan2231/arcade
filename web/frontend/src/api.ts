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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
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

export function getSession(): Promise<User> {
  return api<User>("/api/auth/session");
}

export function login(payload: LoginRequest): Promise<User> {
  return api<User>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function signup(payload: SignupRequest): Promise<User> {
  return api<User>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logout(): Promise<null> {
  return api<null>("/api/auth/logout", {
    method: "POST",
    body: "{}",
  });
}

export function listGroups(): Promise<Group[]> {
  return api<Group[]>("/api/groups");
}

export function createGroup(payload: CreateGroupRequest): Promise<Group> {
  return api<Group>("/api/groups", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listGroupDailyFeeds(groupID: string): Promise<DailyFeed[]> {
  return api<DailyFeed[]>(`/api/groups/${encodeURIComponent(groupID)}/daily-feeds`);
}

export function listGroupCatalogSources(groupID: string): Promise<CatalogSource[]> {
  return api<CatalogSource[]>(`/api/groups/${encodeURIComponent(groupID)}/catalog-sources`);
}

export function createGroupDailyFeed(groupID: string, payload: CreateDailyFeedRequest): Promise<DailyFeed> {
  return api<DailyFeed>(`/api/groups/${encodeURIComponent(groupID)}/daily-feeds`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function previewGroupDailyFeed(groupID: string, payload: CreateDailyFeedRequest): Promise<DailyFeedPreview> {
  return api<DailyFeedPreview>(`/api/groups/${encodeURIComponent(groupID)}/daily-feeds/preview`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getGroupDailyFeedToday(groupID: string, feedID: string): Promise<DailyFeedOutput> {
  return api<DailyFeedOutput>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/today`,
  );
}

export function getGroupDailyFeedOutput(groupID: string, feedID: string, date: string): Promise<DailyFeedOutput> {
  return api<DailyFeedOutput>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/outputs/${encodeURIComponent(date)}`,
  );
}

export function listGroupFeedPosts(groupID: string, feedID: string, date: string): Promise<GroupFeedPost[]> {
  return api<GroupFeedPost[]>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/outputs/${encodeURIComponent(date)}/posts`,
  );
}

export function createGroupFeedPost(
  groupID: string,
  feedID: string,
  date: string,
  payload: CreateGroupFeedPostRequest,
): Promise<GroupFeedPost> {
  return api<GroupFeedPost>(
    `/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}/outputs/${encodeURIComponent(date)}/posts`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function updateGroupFeedPost(
  groupID: string,
  postID: string,
  payload: PatchGroupFeedPostRequest,
): Promise<GroupFeedPost> {
  return api<GroupFeedPost>(`/api/groups/${encodeURIComponent(groupID)}/feed-posts/${encodeURIComponent(postID)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteGroupFeedPost(groupID: string, postID: string): Promise<null> {
  return api<null>(`/api/groups/${encodeURIComponent(groupID)}/feed-posts/${encodeURIComponent(postID)}`, {
    method: "DELETE",
  });
}

export function updateGroupDailyFeed(
  groupID: string,
  feedID: string,
  payload: Partial<Pick<DailyFeed, "enabled">>,
): Promise<DailyFeed> {
  return api<DailyFeed>(`/api/groups/${encodeURIComponent(groupID)}/daily-feeds/${encodeURIComponent(feedID)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
