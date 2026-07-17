import { PublicPage } from "../components/PublicPages";
import type { Group, PublicRoute } from "../types";
import type { Navigate } from "./types";

export function PublicRouteAdapter({
  route,
  signedIn,
  currentUserId = null,
  onNavigate,
  onGroupJoined,
  onUnauthorized,
}: {
  route: PublicRoute;
  signedIn: boolean;
  currentUserId?: string | null;
  onNavigate: Navigate;
  onGroupJoined?: (group: Group) => void;
  onUnauthorized?: () => void;
}) {
  return (
    <PublicPage
      currentUserId={currentUserId}
      onGroupJoined={onGroupJoined}
      onNavigate={onNavigate}
      onUnauthorized={onUnauthorized}
      route={route}
      signedIn={signedIn}
    />
  );
}
