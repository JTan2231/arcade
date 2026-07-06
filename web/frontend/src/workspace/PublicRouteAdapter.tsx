import { PublicPage } from "../components/PublicPages";
import type { PublicRoute } from "../types";
import type { Navigate } from "./types";

export function PublicRouteAdapter({
  route,
  signedIn,
  onNavigate,
}: {
  route: PublicRoute;
  signedIn: boolean;
  onNavigate: Navigate;
}) {
  return <PublicPage onNavigate={onNavigate} route={route} signedIn={signedIn} />;
}
