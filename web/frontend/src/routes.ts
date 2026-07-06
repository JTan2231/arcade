import type { Group, PublicRoute } from "./types";

type InviteRoute = {
  kind: "invite";
  token: string;
};

export type AppRoute = "workspace" | PublicRoute | InviteRoute;

export function readAppRoute(): AppRoute {
  let segments: string[];
  try {
    segments = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return "workspace";
  }
  const resourceId = segments[1];
  if (segments[0] === "join" && segments.length === 2 && resourceId !== undefined && resourceId !== "") {
    return {
      kind: "invite",
      token: resourceId,
    };
  }
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

export function groupPath(group: Group): string {
  return `/g/${encodeURIComponent(group.slug)}`;
}

export function feedPath(feedId: string, date: string | null = null): string {
  const encodedFeedId = encodeURIComponent(feedId);
  return date === null || date === "" ? `/f/${encodedFeedId}` : `/f/${encodedFeedId}/${encodeURIComponent(date)}`;
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
