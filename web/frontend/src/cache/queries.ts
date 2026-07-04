import * as api from "../api";
import type {
  CatalogSource,
  DailyFeed,
  DailyFeedOutput,
  DailyFeedOutputSummary,
  EvidenceFormat,
  FeedMetric,
  Friend,
  FriendRequests,
  Group,
  GroupFeedPost,
  GroupFeedPostRoute,
  GroupInvite,
  GroupInviteCandidate,
  GroupMember,
  GroupPostTag,
  MetricLeaderboard,
  PublicFeed,
  PublicGroup,
  PublicPost,
} from "../types";
import { defineQuery, type QueryFetcherOptions } from "./queryCache";

export type ArchiveMode = "active" | "all";

const FAST_STALE_MS = 5_000;
const DEFAULT_STALE_MS = 15_000;
const SLOW_STALE_MS = 60_000;
const DEFAULT_EXPIRES_MS = 5 * 60_000;

export function archiveMode(includeArchived: boolean): ArchiveMode {
  return includeArchived ? "all" : "active";
}

export const queries = {
  groups: defineQuery({
    key: (uid: string) => ["user", uid, "groups"] as const,
    fetch: (_uid: string, options: QueryFetcherOptions): Promise<Group[]> => api.listGroups(options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  groupFeeds: defineQuery({
    key: (uid: string, groupID: string) => ["user", uid, "group", groupID, "feeds"] as const,
    fetch: (_uid: string, groupID: string, options: QueryFetcherOptions): Promise<DailyFeed[]> =>
      api.listGroupDailyFeeds(groupID, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
    dependsOn: (uid: string, groupID: string) => [["user", uid, "group", groupID, "evidence-formats"]],
  }),

  groupMembers: defineQuery({
    key: (uid: string, groupID: string) => ["user", uid, "group", groupID, "members"] as const,
    fetch: (_uid: string, groupID: string, options: QueryFetcherOptions): Promise<GroupMember[]> =>
      api.listGroupMembers(groupID, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  groupPostTags: defineQuery({
    key: (uid: string, groupID: string, mode: ArchiveMode) =>
      ["user", uid, "group", groupID, "post-tags", mode] as const,
    fetch: (_uid: string, groupID: string, mode: ArchiveMode, options: QueryFetcherOptions): Promise<GroupPostTag[]> =>
      api.listGroupPostTags(groupID, { includeArchived: mode === "all" }, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  groupEvidenceFormats: defineQuery({
    key: (uid: string, groupID: string, mode: ArchiveMode) =>
      ["user", uid, "group", groupID, "evidence-formats", mode] as const,
    fetch: (
      _uid: string,
      groupID: string,
      mode: ArchiveMode,
      options: QueryFetcherOptions,
    ): Promise<EvidenceFormat[]> => api.listGroupEvidenceFormats(groupID, { includeArchived: mode === "all" }, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  groupCatalogSources: defineQuery({
    key: (uid: string, groupID: string) => ["user", uid, "group", groupID, "catalog-sources"] as const,
    fetch: (_uid: string, groupID: string, options: QueryFetcherOptions): Promise<CatalogSource[]> =>
      api.listGroupCatalogSources(groupID, options),
    staleMs: SLOW_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  feedToday: defineQuery({
    key: (uid: string, groupID: string, feedID: string) =>
      ["user", uid, "group", groupID, "feed", feedID, "today"] as const,
    fetch: (_uid: string, groupID: string, feedID: string, options: QueryFetcherOptions): Promise<DailyFeedOutput> =>
      api.getGroupDailyFeedToday(groupID, feedID, options),
    staleMs: FAST_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  feedOutput: defineQuery({
    key: (uid: string, groupID: string, feedID: string, date: string) =>
      ["user", uid, "group", groupID, "feed", feedID, "output", date] as const,
    fetch: (
      _uid: string,
      groupID: string,
      feedID: string,
      date: string,
      options: QueryFetcherOptions,
    ): Promise<DailyFeedOutput> => api.getGroupDailyFeedOutput(groupID, feedID, date, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  feedOutputSummaries: defineQuery({
    key: (uid: string, groupID: string, feedID: string, selectedDate: string) =>
      ["user", uid, "group", groupID, "feed", feedID, "outputs", selectedDate] as const,
    fetch: (
      _uid: string,
      groupID: string,
      feedID: string,
      selectedDate: string,
      options: QueryFetcherOptions,
    ): Promise<DailyFeedOutputSummary[]> =>
      api.listGroupDailyFeedOutputSummaries(groupID, feedID, selectedDate, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  feedPosts: defineQuery({
    key: (uid: string, groupID: string, feedID: string, date: string) =>
      ["user", uid, "group", groupID, "feed", feedID, "posts", date] as const,
    fetch: (
      _uid: string,
      groupID: string,
      feedID: string,
      date: string,
      options: QueryFetcherOptions,
    ): Promise<GroupFeedPost[]> => api.listGroupFeedPosts(groupID, feedID, date, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
    dependsOn: (uid: string, groupID: string) => [
      ["user", uid, "group", groupID, "post-tags"],
      ["user", uid, "group", groupID, "evidence-formats"],
    ],
  }),

  feedMetrics: defineQuery({
    key: (uid: string, groupID: string, feedID: string) =>
      ["user", uid, "group", groupID, "feed", feedID, "metrics"] as const,
    fetch: (_uid: string, groupID: string, feedID: string, options: QueryFetcherOptions): Promise<FeedMetric[]> =>
      api.listFeedMetrics(groupID, feedID, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  feedMetric: defineQuery({
    key: (uid: string, groupID: string, feedID: string, metricID: string) =>
      ["user", uid, "group", groupID, "feed", feedID, "metric", metricID] as const,
    fetch: (
      _uid: string,
      groupID: string,
      feedID: string,
      metricID: string,
      options: QueryFetcherOptions,
    ): Promise<FeedMetric> => api.getFeedMetric(groupID, feedID, metricID, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
    dependsOn: (uid: string, groupID: string, feedID: string) => [
      ["user", uid, "group", groupID, "feed", feedID, "metrics"],
    ],
  }),

  metricLeaderboard: defineQuery({
    key: (uid: string, groupID: string, feedID: string, metricID: string) =>
      ["user", uid, "group", groupID, "feed", feedID, "metric", metricID, "leaderboard"] as const,
    fetch: (
      _uid: string,
      groupID: string,
      feedID: string,
      metricID: string,
      options: QueryFetcherOptions,
    ): Promise<MetricLeaderboard> => api.getMetricLeaderboard(groupID, feedID, metricID, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
    dependsOn: (uid: string, groupID: string, feedID: string, metricID: string) => [
      ["user", uid, "group", groupID, "feed", feedID, "posts"],
      ["user", uid, "group", groupID, "feed", feedID, "metrics"],
      ["user", uid, "group", groupID, "feed", feedID, "metric", metricID, "judgments"],
    ],
  }),

  friendRequests: defineQuery({
    key: (uid: string) => ["user", uid, "social", "friend-requests"] as const,
    fetch: (_uid: string, options: QueryFetcherOptions): Promise<FriendRequests> => api.listFriendRequests(options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  friends: defineQuery({
    key: (uid: string) => ["user", uid, "social", "friends"] as const,
    fetch: (_uid: string, options: QueryFetcherOptions): Promise<Friend[]> => api.listFriends(options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  groupInvites: defineQuery({
    key: (uid: string) => ["user", uid, "social", "group-invites"] as const,
    fetch: (_uid: string, options: QueryFetcherOptions): Promise<GroupInvite[]> => api.listGroupInvites(options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  inviteCandidates: defineQuery({
    key: (uid: string, groupID: string) => ["user", uid, "group", groupID, "invite-candidates"] as const,
    fetch: (_uid: string, groupID: string, options: QueryFetcherOptions): Promise<GroupInviteCandidate[]> =>
      api.listGroupInviteCandidates(groupID, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
    dependsOn: (uid: string, groupID: string) => [
      ["user", uid, "social", "friends"],
      ["user", uid, "social", "group-invites"],
      ["user", uid, "group", groupID, "members"],
    ],
  }),

  meDailyFeeds: defineQuery({
    key: (uid: string) => ["user", uid, "me", "daily-feeds"] as const,
    fetch: (_uid: string, options: QueryFetcherOptions): Promise<DailyFeed[]> => api.listMeDailyFeeds(options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
    dependsOn: (uid: string) => [["user", uid, "groups"]],
  }),

  memberFeedPostRoute: defineQuery({
    key: (uid: string, postID: string) => ["user", uid, "me", "feed-post-route", postID] as const,
    fetch: (_uid: string, postID: string, options: QueryFetcherOptions): Promise<GroupFeedPostRoute> =>
      api.getMemberFeedPostRoute(postID, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  publicGroup: defineQuery({
    key: (slug: string) => ["anon", "public", "group", slug] as const,
    fetch: (slug: string, options: QueryFetcherOptions): Promise<PublicGroup> => api.getPublicGroup(slug, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  publicFeed: defineQuery({
    key: (feedID: string, date: string | null) => ["anon", "public", "feed", feedID, date] as const,
    fetch: (feedID: string, date: string | null, options: QueryFetcherOptions): Promise<PublicFeed> =>
      date === null ? api.getPublicFeed(feedID, options) : api.getPublicFeedOutput(feedID, date, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  publicFeedOutputSummaries: defineQuery({
    key: (feedID: string, selectedDate: string) => ["anon", "public", "feed", feedID, "outputs", selectedDate] as const,
    fetch: (feedID: string, selectedDate: string, options: QueryFetcherOptions): Promise<DailyFeedOutputSummary[]> =>
      api.listPublicFeedOutputSummaries(feedID, selectedDate, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),

  publicPost: defineQuery({
    key: (postID: string) => ["anon", "public", "post", postID] as const,
    fetch: (postID: string, options: QueryFetcherOptions): Promise<PublicPost> => api.getPublicPost(postID, options),
    staleMs: DEFAULT_STALE_MS,
    expiresMs: DEFAULT_EXPIRES_MS,
  }),
};
