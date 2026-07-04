import type { Group, PublicRoute, User } from "./types";

export type AppRoute = "workspace" | "profile" | PublicRoute;

export function readAppRoute(): AppRoute {
  let segments: string[];
  try {
    segments = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return "workspace";
  }
  if (segments[0] === "user") {
    return "profile";
  }
  const resourceId = segments[1];
  if (segments[0] === "g" && segments.length === 2 && resourceId !== undefined && resourceId !== "") {
    return {
      kind: "group",
      slug: resourceId,
    };
  }
  if (
    segments[0] === "f" &&
    (segments.length === 2 || segments.length === 3) &&
    resourceId !== undefined &&
    resourceId !== ""
  ) {
    return {
      kind: "feed",
      feedId: resourceId,
      date: segments[2] ?? null,
    };
  }
  if (segments[0] === "p" && segments.length === 2 && resourceId !== undefined && resourceId !== "") {
    return {
      kind: "post",
      postId: resourceId,
    };
  }
  return "workspace";
}

export function userProfilePath(user: User): string {
  return `/user/${encodeURIComponent(user.display_name)}`;
}

export function groupPath(group: Group): string {
  return `/g/${encodeURIComponent(group.slug)}`;
}

export function feedPath(feedId: string, date: string | null = null): string {
  const encodedFeedId = encodeURIComponent(feedId);
  return date === null || date === "" ? `/f/${encodedFeedId}` : `/f/${encodedFeedId}/${encodeURIComponent(date)}`;
}

export function postPath(postId: string): string {
  return `/p/${encodeURIComponent(postId)}`;
}

export function publicRouteCacheKey(route: PublicRoute): string {
  switch (route.kind) {
    case "group":
      return `group:${route.slug}`;
    case "feed":
      return `feed:${route.feedId}:${route.date ?? ""}`;
    case "post":
      return `post:${route.postId}`;
  }
}
