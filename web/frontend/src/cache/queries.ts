import * as api from "../api";
import type {
  CatalogSource,
  DailyFeed,
  DailyFeedEvent,
  DailyFeedOutput,
  DailyFeedOutputSummary,
  EvidenceFormat,
  FeedMetric,
  Group,
  GroupFeedPost,
  GroupFeedPostRoute,
  GroupInviteLink,
  GroupMember,
  GroupPostTag,
  MetricLeaderboard,
  PublicFeed,
  PublicGroup,
  PublicPost,
} from "../types";
import { defineQuery, type QueryFetcherOptions } from "./queryCache";

export type ArchiveMode = "active" | "all";

const QUERY_TTL_MS = 5 * 60_000;

export function archiveMode(includeArchived: boolean): ArchiveMode {
  return includeArchived ? "all" : "active";
}

export const queries = {
  groups: defineQuery({
    key: (uid: string) => ["user", uid, "groups"] as const,
    fetch: (_uid: string, options: QueryFetcherOptions): Promise<Group[]> => api.listGroups(options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
  }),

  groupFeeds: defineQuery({
    key: (uid: string, groupID: string) => ["user", uid, "group", groupID, "feeds"] as const,
    fetch: (_uid: string, groupID: string, options: QueryFetcherOptions): Promise<DailyFeed[]> =>
      api.listGroupDailyFeeds(groupID, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
    dependsOn: (uid: string, groupID: string) => [["user", uid, "group", groupID, "evidence-formats"]],
  }),

  groupMembers: defineQuery({
    key: (uid: string, groupID: string) => ["user", uid, "group", groupID, "members"] as const,
    fetch: (_uid: string, groupID: string, options: QueryFetcherOptions): Promise<GroupMember[]> =>
      api.listGroupMembers(groupID, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
  }),

  groupPostTags: defineQuery({
    key: (uid: string, groupID: string, mode: ArchiveMode) =>
      ["user", uid, "group", groupID, "post-tags", mode] as const,
    fetch: (_uid: string, groupID: string, mode: ArchiveMode, options: QueryFetcherOptions): Promise<GroupPostTag[]> =>
      api.listGroupPostTags(groupID, { includeArchived: mode === "all" }, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
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
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
  }),

  groupCatalogSources: defineQuery({
    key: (uid: string, groupID: string) => ["user", uid, "group", groupID, "catalog-sources"] as const,
    fetch: (_uid: string, groupID: string, options: QueryFetcherOptions): Promise<CatalogSource[]> =>
      api.listGroupCatalogSources(groupID, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
  }),

  feedEvents: defineQuery({
    key: (uid: string, groupID: string, feedID: string) =>
      ["user", uid, "group", groupID, "feed", feedID, "events"] as const,
    fetch: (_uid: string, groupID: string, feedID: string, options: QueryFetcherOptions): Promise<DailyFeedEvent[]> =>
      api.listGroupDailyFeedEvents(groupID, feedID, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
  }),

  feedToday: defineQuery({
    key: (uid: string, groupID: string, feedID: string) =>
      ["user", uid, "group", groupID, "feed", feedID, "today"] as const,
    fetch: (_uid: string, groupID: string, feedID: string, options: QueryFetcherOptions): Promise<DailyFeedOutput> =>
      api.getGroupDailyFeedToday(groupID, feedID, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
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
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
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
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
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
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
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
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
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
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
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
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
    dependsOn: (uid: string, groupID: string, feedID: string, metricID: string) => [
      ["user", uid, "group", groupID, "feed", feedID, "posts"],
      ["user", uid, "group", groupID, "feed", feedID, "metrics"],
      ["user", uid, "group", groupID, "feed", feedID, "metric", metricID, "judgments"],
    ],
  }),

  groupInviteLinks: defineQuery({
    key: (uid: string, groupID: string) => ["user", uid, "group", groupID, "invite-links"] as const,
    fetch: (_uid: string, groupID: string, options: QueryFetcherOptions): Promise<GroupInviteLink[]> =>
      api.listGroupInviteLinks(groupID, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
  }),

  meDailyFeeds: defineQuery({
    key: (uid: string) => ["user", uid, "me", "daily-feeds"] as const,
    fetch: (_uid: string, options: QueryFetcherOptions): Promise<DailyFeed[]> => api.listMeDailyFeeds(options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
    dependsOn: (uid: string) => [["user", uid, "groups"]],
  }),

  memberFeedPostRoute: defineQuery({
    key: (uid: string, postID: string) => ["user", uid, "me", "feed-post-route", postID] as const,
    fetch: (_uid: string, postID: string, options: QueryFetcherOptions): Promise<GroupFeedPostRoute> =>
      api.getMemberFeedPostRoute(postID, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
  }),

  publicGroup: defineQuery({
    key: (slug: string) => ["anon", "public", "group", slug] as const,
    fetch: (slug: string, options: QueryFetcherOptions): Promise<PublicGroup> => api.getPublicGroup(slug, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
  }),

  publicFeed: defineQuery({
    key: (feedID: string, date: string | null) => ["anon", "public", "feed", feedID, date] as const,
    fetch: (feedID: string, date: string | null, options: QueryFetcherOptions): Promise<PublicFeed> =>
      date === null ? api.getPublicFeed(feedID, options) : api.getPublicFeedOutput(feedID, date, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
  }),

  publicFeedOutputSummaries: defineQuery({
    key: (feedID: string, selectedDate: string) => ["anon", "public", "feed", feedID, "outputs", selectedDate] as const,
    fetch: (feedID: string, selectedDate: string, options: QueryFetcherOptions): Promise<DailyFeedOutputSummary[]> =>
      api.listPublicFeedOutputSummaries(feedID, selectedDate, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
  }),

  publicPost: defineQuery({
    key: (postID: string) => ["anon", "public", "post", postID] as const,
    fetch: (postID: string, options: QueryFetcherOptions): Promise<PublicPost> => api.getPublicPost(postID, options),
    staleMs: QUERY_TTL_MS,
    expiresMs: QUERY_TTL_MS,
  }),
};
