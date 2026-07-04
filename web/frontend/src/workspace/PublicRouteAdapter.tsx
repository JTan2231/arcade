import { PublicPage } from "../components/PublicPages";
import { postPath } from "../routes";
import type { PublicRoute } from "../types";
import { copyPublicPath } from "./copyPublicPath";
import type { Navigate, ToastCallback } from "./types";

export function PublicRouteAdapter({
  route,
  signedIn,
  onNavigate,
  onToast,
}: {
  route: PublicRoute;
  signedIn: boolean;
  onNavigate: Navigate;
  onToast: ToastCallback;
}) {
  return (
    <PublicPage
      onCopyPublicPostLink={(postId) => void copyPublicPath(postPath(postId), "Post link copied", onToast)}
      onNavigate={onNavigate}
      route={route}
      signedIn={signedIn}
    />
  );
}
