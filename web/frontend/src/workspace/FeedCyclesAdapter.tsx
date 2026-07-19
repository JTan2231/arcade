import { FeedCyclesDialog } from "../components/groups/FeedCyclesDialog";
import { matchesTopState } from "../machines/stateMatches";
import type { FeedCyclesContext } from "../machines/feedCyclesMachine";
import type { FeedCyclesActorRef } from "./types";

export function FeedCyclesAdapter({
  feedCyclesRef,
  context,
  stateValue,
}: {
  feedCyclesRef: FeedCyclesActorRef | undefined;
  context: FeedCyclesContext | null;
  stateValue: unknown;
}) {
  if (feedCyclesRef === undefined || context === null) {
    return null;
  }

  const loading = matchesTopState(stateValue, "loading");
  const previewLoading = matchesTopState(stateValue, "previewing");
  const saving = matchesTopState(stateValue, "saving");
  const deleting = matchesTopState(stateValue, "deleting");
  const refreshing = matchesTopState(stateValue, "refreshing");

  return (
    <FeedCyclesDialog
      busy={previewLoading || saving || deleting || refreshing}
      cycles={context.cycles}
      editorOpen={context.editorOpen}
      error={context.error}
      feed={context.feed}
      loading={loading}
      preview={context.preview}
      previewLoading={previewLoading}
      refreshingCycleId={refreshing ? context.pendingCycleId : null}
      saving={saving}
      settings={context.settings}
      sources={context.sources}
      onClose={() => feedCyclesRef.send({ type: "CLOSED" })}
      onCloseEditor={() => feedCyclesRef.send({ type: "EDITOR_CLOSED" })}
      onDelete={() => feedCyclesRef.send({ type: "DELETE_SUBMITTED" })}
      onDraftChanged={() => feedCyclesRef.send({ type: "DRAFT_CHANGED" })}
      onOpenEditor={() => feedCyclesRef.send({ type: "EDITOR_OPENED" })}
      onPreview={(payload) => feedCyclesRef.send({ type: "PREVIEW_SUBMITTED", payload })}
      onRefresh={(cycleId) => feedCyclesRef.send({ type: "REFRESH_SUBMITTED", cycleId })}
      onSave={(payload) => feedCyclesRef.send({ type: "SAVE_SUBMITTED", payload })}
    />
  );
}
