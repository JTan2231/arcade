import { useCallback, useEffect, useMemo, useState } from "react";

import { createGroupInviteLink, isUnauthorized, revokeGroupInviteLink } from "../api";
import { queries } from "../cache/queries";
import { queryCache } from "../cache/queryCache";
import { errorMessage } from "../errors";
import type { CreateGroupInviteLinkRequest, Group, GroupInviteLink } from "../types";

const EMPTY_INVITE_LINKS: GroupInviteLink[] = [];

export type InviteLinkAdapterProps = {
  inviteLinks: GroupInviteLink[];
  inviteLinksLoading: boolean;
  inviteLinksError: string;
  creatingInviteLink: boolean;
  revokingInviteLinkId: string | null;
  createdInviteURL: string;
  onCreateInviteLink: (payload: CreateGroupInviteLinkRequest) => void;
  onRevokeInviteLink: (linkId: string) => void;
  onClearCreatedInviteURL: () => void;
};

export function useInviteLinks({
  signedIn,
  selectedGroup,
  currentUserId,
  onUnauthorized,
  onToast,
}: {
  signedIn: boolean;
  selectedGroup: Group | null;
  currentUserId: string | null;
  onUnauthorized: () => void;
  onToast: (message: string) => void;
}): InviteLinkAdapterProps {
  const [inviteLinks, setInviteLinks] = useState<GroupInviteLink[]>(EMPTY_INVITE_LINKS);
  const [inviteLinksLoading, setInviteLinksLoading] = useState(false);
  const [inviteLinksError, setInviteLinksError] = useState("");
  const [creatingInviteLink, setCreatingInviteLink] = useState(false);
  const [revokingInviteLinkId, setRevokingInviteLinkId] = useState<string | null>(null);
  const [createdInviteURL, setCreatedInviteURL] = useState("");
  const selectedGroupId = selectedGroup?.id ?? null;

  const handleInviteLinkError = useCallback(
    (error: unknown) => {
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      const message = errorMessage(error);
      setInviteLinksError(message);
      onToast(message);
    },
    [onToast, onUnauthorized],
  );

  const refreshInviteLinks = useCallback(
    async (options: { signal?: AbortSignal } = {}) => {
      if (
        currentUserId === null ||
        selectedGroup === null ||
        selectedGroup.my_status !== "active" ||
        (selectedGroup.my_role !== "owner" && selectedGroup.my_role !== "admin")
      ) {
        setInviteLinks(EMPTY_INVITE_LINKS);
        setInviteLinksLoading(false);
        return;
      }

      setInviteLinksLoading(true);
      setInviteLinksError("");
      try {
        const apiOptions = options.signal === undefined ? {} : { signal: options.signal };
        const links = await queryCache.read(queries.groupInviteLinks, currentUserId, selectedGroup.id, apiOptions);
        if (options.signal?.aborted === true) {
          return;
        }
        setInviteLinks(links);
      } catch (error) {
        if (options.signal?.aborted !== true) {
          handleInviteLinkError(error);
        }
      } finally {
        if (options.signal?.aborted !== true) {
          setInviteLinksLoading(false);
        }
      }
    },
    [currentUserId, handleInviteLinkError, selectedGroup],
  );

  useEffect(() => {
    if (!signedIn) {
      setInviteLinks(EMPTY_INVITE_LINKS);
      setInviteLinksLoading(false);
      setInviteLinksError("");
      setCreatedInviteURL("");
      return undefined;
    }

    const controller = new AbortController();
    void refreshInviteLinks({ signal: controller.signal });
    return () => controller.abort();
  }, [refreshInviteLinks, signedIn]);

  const handleCreateInviteLink = useCallback(
    (payload: CreateGroupInviteLinkRequest) => {
      if (currentUserId === null || selectedGroupId === null) {
        return;
      }
      setCreatingInviteLink(true);
      setInviteLinksError("");
      void createGroupInviteLink(selectedGroupId, payload)
        .then(async (link) => {
          queryCache.touched(["user", currentUserId, "group", selectedGroupId, "invite-links"]);
          await refreshInviteLinks();
          const path = link.url_path ?? (link.token === undefined ? "" : `/join/${encodeURIComponent(link.token)}`);
          setCreatedInviteURL(path === "" ? "" : `${window.location.origin}${path}`);
          onToast("Invite link created");
        })
        .catch(handleInviteLinkError)
        .finally(() => setCreatingInviteLink(false));
    },
    [currentUserId, handleInviteLinkError, onToast, refreshInviteLinks, selectedGroupId],
  );

  const handleRevokeInviteLink = useCallback(
    (linkId: string) => {
      if (currentUserId === null || selectedGroupId === null) {
        return;
      }
      setRevokingInviteLinkId(linkId);
      setInviteLinksError("");
      void revokeGroupInviteLink(selectedGroupId, linkId)
        .then(async () => {
          queryCache.touched(["user", currentUserId, "group", selectedGroupId, "invite-links"]);
          await refreshInviteLinks();
          onToast("Invite link revoked");
        })
        .catch(handleInviteLinkError)
        .finally(() => setRevokingInviteLinkId(null));
    },
    [currentUserId, handleInviteLinkError, onToast, refreshInviteLinks, selectedGroupId],
  );

  return useMemo(
    () => ({
      inviteLinks,
      inviteLinksLoading,
      inviteLinksError,
      creatingInviteLink,
      revokingInviteLinkId,
      createdInviteURL,
      onCreateInviteLink: handleCreateInviteLink,
      onRevokeInviteLink: handleRevokeInviteLink,
      onClearCreatedInviteURL: () => setCreatedInviteURL(""),
    }),
    [
      createdInviteURL,
      creatingInviteLink,
      handleCreateInviteLink,
      handleRevokeInviteLink,
      inviteLinks,
      inviteLinksError,
      inviteLinksLoading,
      revokingInviteLinkId,
    ],
  );
}
