import { FeedEventsDialog } from "../components/groups/FeedEventsDialog";
import { matchesTopState } from "../machines/stateMatches";
import type { FeedEventsContext } from "../machines/feedEventsMachine";
import type { FeedEventsActorRef } from "./types";

export function FeedEventsAdapter({
  feedEventsRef,
  context,
  stateValue,
}: {
  feedEventsRef: FeedEventsActorRef | undefined;
  context: FeedEventsContext | null;
  stateValue: unknown;
}) {
  if (feedEventsRef === undefined || context === null) {
    return null;
  }

  const loading = matchesTopState(stateValue, "loading");
  const previewLoading = matchesTopState(stateValue, "previewing");
  const saving = matchesTopState(stateValue, "saving");
  const deleting = matchesTopState(stateValue, "deleting");
  const editingEvent =
    context.editingEventId === null
      ? null
      : (context.events.find((event) => event.id === context.editingEventId) ?? null);

  return (
    <FeedEventsDialog
      busy={previewLoading || saving || deleting}
      editorMode={context.editorMode}
      editingEvent={editingEvent}
      error={context.error}
      events={context.events}
      feed={context.feed}
      loading={loading}
      preview={context.preview}
      previewLoading={previewLoading}
      saving={saving}
      sources={context.sources}
      onClose={() => feedEventsRef.send({ type: "CLOSED" })}
      onCloseEditor={() => feedEventsRef.send({ type: "EDITOR_CLOSED" })}
      onDelete={(eventId) => feedEventsRef.send({ type: "DELETE_SUBMITTED", eventId })}
      onDraftChanged={() => feedEventsRef.send({ type: "DRAFT_CHANGED" })}
      onOpenCreate={() => feedEventsRef.send({ type: "CREATE_OPENED" })}
      onOpenEdit={(eventId) => feedEventsRef.send({ type: "EDIT_OPENED", eventId })}
      onPreview={(payload) => feedEventsRef.send({ type: "PREVIEW_SUBMITTED", payload })}
      onSave={(payload) => feedEventsRef.send({ type: "SAVE_SUBMITTED", payload })}
    />
  );
}
