import type {
  DailyFeedOutput,
  DailyFeedOutputItem,
  DailyFeedOutputSummary,
  GroupFeedPost,
  GroupPostTag,
} from "../../types";

export function feedOutputSummary(output: DailyFeedOutput): DailyFeedOutputSummary {
  if (output.items.length === 1) {
    return {
      feed_id: output.feed_id,
      date: output.date,
      title: outputItemDisplayTitle(output.items[0]!),
      subtitle: output.date,
    };
  }
  if (output.items.length > 1) {
    return {
      feed_id: output.feed_id,
      date: output.date,
      title: output.date,
    };
  }
  return {
    feed_id: output.feed_id,
    date: output.date,
    title: firstNonEmpty(output.title, output.date),
    subtitle: output.date,
  };
}

export function selectedActivePostTagIDs(post: GroupFeedPost, activeTags: GroupPostTag[]): string[] {
  const activeTagIds = new Set(activeTags.map((tag) => tag.id));
  return post.tags.filter((tag) => activeTagIds.has(tag.id)).map((tag) => tag.id);
}

export function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}

export function outputItemDisplayTitle(item: DailyFeedOutputItem): string {
  return firstNonEmpty(
    item.item.title,
    primitiveDisplay(item.item.data["name"]),
    primitiveDisplay(item.item.data["title"]),
    "Untitled",
  );
}

export function primitiveDisplay(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

export function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.find((value): value is string => value !== undefined && value !== null && value !== "") ?? "";
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
