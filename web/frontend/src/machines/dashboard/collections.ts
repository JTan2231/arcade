import type {
  CreateEvidenceFormatRequest,
  DailyFeed,
  EvidenceFormat,
  FeedMetric,
  GroupFeedPost,
  GroupPostTag,
} from "../../types";

export function replaceFeed(feeds: DailyFeed[], updated: DailyFeed): DailyFeed[] {
  return feeds.map((feed) => (feed.id === updated.id ? updated : feed));
}

export function removeFeed(feeds: DailyFeed[], feedId: string): DailyFeed[] {
  return feeds.filter((feed) => feed.id !== feedId);
}

export function upsertPost(posts: GroupFeedPost[], post: GroupFeedPost): GroupFeedPost[] {
  return [post, ...posts.filter((candidate) => candidate.id !== post.id)];
}

export function upsertPostTag(tags: GroupPostTag[], tag: GroupPostTag): GroupPostTag[] {
  return [...tags.filter((candidate) => candidate.id !== tag.id), tag].sort(postTagSort);
}

export function upsertEvidenceFormat(formats: EvidenceFormat[], format: EvidenceFormat): EvidenceFormat[] {
  return [...formats.filter((candidate) => candidate.id !== format.id), format].sort(evidenceFormatSort);
}

export function updateEvidenceFormatAssignedFeedCount(
  formats: EvidenceFormat[],
  formatId: string,
  delta: number,
): EvidenceFormat[] {
  return formats
    .map((format) =>
      format.id === formatId
        ? { ...format, assigned_feed_count: Math.max(0, format.assigned_feed_count + delta) }
        : format,
    )
    .sort(evidenceFormatSort);
}

export function updateEvidenceFormatFeedCountsForFeedChange(
  formats: EvidenceFormat[],
  previousFormatId: string | null,
  nextFormatId: string,
): EvidenceFormat[] {
  if (previousFormatId === null || previousFormatId === nextFormatId) {
    return formats;
  }
  return updateEvidenceFormatAssignedFeedCount(
    updateEvidenceFormatAssignedFeedCount(formats, previousFormatId, -1),
    nextFormatId,
    1,
  );
}

export function upsertMetric(metrics: FeedMetric[], metric: FeedMetric): FeedMetric[] {
  return [...metrics.filter((candidate) => candidate.id !== metric.id), metric].sort(metricSort);
}

export function replaceMetric(metrics: FeedMetric[], metric: FeedMetric): FeedMetric[] {
  return metrics.map((candidate) => (candidate.id === metric.id ? metric : candidate)).sort(metricSort);
}

export function removeMetric(metrics: FeedMetric[], metricId: string): FeedMetric[] {
  return metrics.filter((metric) => metric.id !== metricId);
}

export function selectedMetricAfterDelete(
  metrics: FeedMetric[],
  selectedMetricId: string | null,
  deletedMetricId: string,
): string | null {
  if (selectedMetricId !== deletedMetricId && metrics.some((metric) => metric.id === selectedMetricId)) {
    return selectedMetricId;
  }
  return metrics[0]?.id ?? null;
}

function metricSort(left: FeedMetric, right: FeedMetric): number {
  const byName = left.display_name.localeCompare(right.display_name, undefined, { sensitivity: "base" });
  if (byName !== 0) {
    return byName;
  }
  return left.id.localeCompare(right.id);
}

function postTagSort(left: GroupPostTag, right: GroupPostTag): number {
  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  if (byName !== 0) {
    return byName;
  }
  return left.id.localeCompare(right.id);
}

function evidenceFormatSort(left: EvidenceFormat, right: EvidenceFormat): number {
  const leftArchived = left.archived_at !== undefined;
  const rightArchived = right.archived_at !== undefined;
  if (leftArchived !== rightArchived) {
    return leftArchived ? 1 : -1;
  }
  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  if (byName !== 0) {
    return byName;
  }
  return left.id.localeCompare(right.id);
}

export function normalizeEvidenceFormatCreatePayload(
  payload: CreateEvidenceFormatRequest,
): CreateEvidenceFormatRequest {
  return {
    ...payload,
    slug: payload.slug.trim(),
    name: payload.name.trim(),
    ...(payload.description !== undefined ? { description: payload.description.trim() } : {}),
  };
}
