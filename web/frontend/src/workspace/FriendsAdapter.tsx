import { FriendsPanel } from "../components/FriendsPanel";
import type { SocialGraphAdapter } from "../social/useSocialGraph";

export function FriendsAdapter({ socialGraph }: { socialGraph: SocialGraphAdapter }) {
  return <FriendsPanel {...socialGraph.friendsPanelProps} />;
}
