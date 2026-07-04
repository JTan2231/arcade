import type { GroupDashboardProps } from "../components/GroupDashboard";
import { matchesChildState, matchesTopState } from "../machines/stateMatches";
import type { AddFeedContext } from "../machines/addFeedMachine";
import { EMPTY_EVIDENCE_FORMATS } from "./empty";
import type { AddFeedActorRef, DashboardActorRef } from "./types";

type AddFeedProps = Pick<
  GroupDashboardProps,
  | "addFeedOpen"
  | "addFeedSources"
  | "addFeedEvidenceFormats"
  | "addFeedSourcesLoading"
  | "addFeedPreview"
  | "addFeedPreviewLoading"
  | "addFeedSaving"
  | "addFeedError"
  | "onCloseAddFeed"
  | "onAddFeedDraftChanged"
  | "onPreviewFeed"
  | "onCreateFeed"
>;

export function useAddFeedAdapter({
  dashboardRef,
  addFeedRef,
  addFeedContext,
  dashboardStateValue,
  addFeedStateValue,
}: {
  dashboardRef: DashboardActorRef | undefined;
  addFeedRef: AddFeedActorRef | undefined;
  addFeedContext: AddFeedContext | null;
  dashboardStateValue: unknown;
  addFeedStateValue: unknown;
}): AddFeedProps {
  const addFeedOpen = matchesChildState(dashboardStateValue, "groupSelected", "addFeed");
  const addFeedLoadingSources = matchesTopState(addFeedStateValue, "loadingSources");
  const addFeedPreviewing = matchesTopState(addFeedStateValue, "previewing");
  const addFeedCreating = matchesTopState(addFeedStateValue, "creating");

  return {
    addFeedOpen,
    addFeedSources: addFeedContext?.sources ?? [],
    addFeedEvidenceFormats: addFeedContext?.evidenceFormats ?? EMPTY_EVIDENCE_FORMATS,
    addFeedSourcesLoading: addFeedLoadingSources,
    addFeedPreview: addFeedContext?.preview ?? null,
    addFeedPreviewLoading: addFeedPreviewing,
    addFeedSaving: addFeedCreating,
    addFeedError: addFeedContext?.error ?? "",
    onCloseAddFeed: () => {
      if (addFeedRef !== undefined) {
        addFeedRef.send({ type: "CLOSED" });
        return;
      }
      dashboardRef?.send({ type: "ADD_FEED_CLOSED" });
    },
    onAddFeedDraftChanged: () => addFeedRef?.send({ type: "DRAFT_CHANGED" }),
    onPreviewFeed: (payload) => addFeedRef?.send({ type: "PREVIEW_SUBMITTED", payload }),
    onCreateFeed: (payload) => addFeedRef?.send({ type: "CREATE_SUBMITTED", payload }),
  };
}
