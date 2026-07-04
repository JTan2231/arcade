import { useCallback, useEffect, useMemo, useState } from "react";

import {
  acceptFriendRequest,
  acceptGroupInvite,
  cancelFriendRequest,
  cancelGroupInvite,
  createFriendRequest,
  createGroupInvite,
  declineFriendRequest,
  declineGroupInvite,
  deleteFriend,
  isUnauthorized,
  listFriendRequests,
  listFriends,
  listGroupInviteCandidates,
  listGroupInvites,
  rotateFriendCode,
} from "../api";
import type { FriendsPanelProps } from "../components/FriendsPanel";
import { errorMessage } from "../errors";
import type { Friend, FriendRequests, Group, GroupInvite, GroupInviteCandidate, User } from "../types";

const EMPTY_FRIENDS: Friend[] = [];
const EMPTY_GROUP_INVITES: GroupInvite[] = [];
const EMPTY_INVITE_CANDIDATES: GroupInviteCandidate[] = [];
const EMPTY_FRIEND_REQUESTS: FriendRequests = {
  incoming: [],
  outgoing: [],
};

export type InviteCandidateAdapterProps = {
  inviteCandidates: GroupInviteCandidate[];
  inviteCandidatesLoading: boolean;
  invitingUserId: string | null;
  onInviteFriend: (userId: string) => void;
  onCancelGroupInvite: (userId: string) => void;
};

export type UseSocialGraphInput = {
  signedIn: boolean;
  showingProfile: boolean;
  selectedGroup: Group | null;
  currentUser: User | null;
  onUnauthorized: () => void;
  onToast: (message: string) => void;
  onUserUpdated: (user: User) => void;
  onGroupInviteAccepted: (groupId: string) => void;
};

export type SocialGraphAdapter = {
  friendsPanelProps: FriendsPanelProps;
  inviteCandidateProps: InviteCandidateAdapterProps;
};

export function useSocialGraph({
  signedIn,
  showingProfile,
  selectedGroup,
  currentUser,
  onUnauthorized,
  onToast,
  onUserUpdated,
  onGroupInviteAccepted,
}: UseSocialGraphInput): SocialGraphAdapter {
  const [friendRequests, setFriendRequests] = useState<FriendRequests>(EMPTY_FRIEND_REQUESTS);
  const [friends, setFriends] = useState<Friend[]>(EMPTY_FRIENDS);
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>(EMPTY_GROUP_INVITES);
  const [inviteCandidates, setInviteCandidates] = useState<GroupInviteCandidate[]>(EMPTY_INVITE_CANDIDATES);
  const [socialLoading, setSocialLoading] = useState(false);
  const [inviteCandidatesLoading, setInviteCandidatesLoading] = useState(false);
  const [socialError, setSocialError] = useState("");
  const [socialMutating, setSocialMutating] = useState<string | null>(null);
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);

  const handleSocialError = useCallback(
    (error: unknown) => {
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      const message = errorMessage(error);
      setSocialError(message);
      onToast(message);
    },
    [onToast, onUnauthorized],
  );

  const refreshSocial = useCallback(
    async (options: { signal?: AbortSignal } = {}) => {
      setSocialLoading(true);
      setSocialError("");
      try {
        const apiOptions = options.signal === undefined ? {} : { signal: options.signal };
        const [nextRequests, nextFriends, nextGroupInvites] = await Promise.all([
          listFriendRequests(apiOptions),
          listFriends(apiOptions),
          listGroupInvites(apiOptions),
        ]);
        if (options.signal?.aborted === true) {
          return;
        }
        setFriendRequests(nextRequests);
        setFriends(nextFriends);
        setGroupInvites(nextGroupInvites);
      } catch (error) {
        if (options.signal?.aborted !== true) {
          handleSocialError(error);
        }
      } finally {
        if (options.signal?.aborted !== true) {
          setSocialLoading(false);
        }
      }
    },
    [handleSocialError],
  );

  const refreshInviteCandidatesForGroup = useCallback(
    async (group: Group | null, options: { signal?: AbortSignal } = {}) => {
      if (group === null || group.my_status !== "active") {
        setInviteCandidates(EMPTY_INVITE_CANDIDATES);
        setInviteCandidatesLoading(false);
        return;
      }
      setInviteCandidatesLoading(true);
      try {
        const apiOptions = options.signal === undefined ? {} : { signal: options.signal };
        const nextCandidates = await listGroupInviteCandidates(group.id, apiOptions);
        if (options.signal?.aborted === true) {
          return;
        }
        setInviteCandidates(nextCandidates);
      } catch (error) {
        if (options.signal?.aborted !== true) {
          handleSocialError(error);
        }
      } finally {
        if (options.signal?.aborted !== true) {
          setInviteCandidatesLoading(false);
        }
      }
    },
    [handleSocialError],
  );

  useEffect(() => {
    if (!signedIn) {
      setFriendRequests(EMPTY_FRIEND_REQUESTS);
      setFriends(EMPTY_FRIENDS);
      setGroupInvites(EMPTY_GROUP_INVITES);
      setInviteCandidates(EMPTY_INVITE_CANDIDATES);
      setSocialLoading(false);
      setInviteCandidatesLoading(false);
      setSocialError("");
      return undefined;
    }

    const controller = new AbortController();
    void refreshSocial({ signal: controller.signal });
    return () => controller.abort();
  }, [refreshSocial, signedIn]);

  useEffect(() => {
    if (!signedIn || showingProfile) {
      setInviteCandidates(EMPTY_INVITE_CANDIDATES);
      setInviteCandidatesLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    void refreshInviteCandidatesForGroup(selectedGroup, { signal: controller.signal });
    return () => controller.abort();
  }, [refreshInviteCandidatesForGroup, selectedGroup, showingProfile, signedIn]);

  const runSocialMutation = useCallback(
    async (key: string, task: () => Promise<string>) => {
      setSocialMutating(key);
      setSocialError("");
      try {
        const message = await task();
        onToast(message);
        await refreshSocial();
        await refreshInviteCandidatesForGroup(selectedGroup);
      } catch (error) {
        handleSocialError(error);
      } finally {
        setSocialMutating(null);
      }
    },
    [handleSocialError, onToast, refreshInviteCandidatesForGroup, refreshSocial, selectedGroup],
  );

  const handleAddFriend = useCallback(
    (friendCode: string) => {
      void runSocialMutation("add-friend", async () => {
        const request = await createFriendRequest(friendCode);
        return request.status === "accepted" ? "Friend added" : "Friend request sent";
      });
    },
    [runSocialMutation],
  );

  const handleAcceptFriendRequest = useCallback(
    (requestId: string) => {
      void runSocialMutation(`accept-request:${requestId}`, async () => {
        await acceptFriendRequest(requestId);
        return "Friend added";
      });
    },
    [runSocialMutation],
  );

  const handleDeclineFriendRequest = useCallback(
    (requestId: string) => {
      void runSocialMutation(`decline-request:${requestId}`, async () => {
        await declineFriendRequest(requestId);
        return "Friend request declined";
      });
    },
    [runSocialMutation],
  );

  const handleCancelFriendRequest = useCallback(
    (requestId: string) => {
      void runSocialMutation(`cancel-request:${requestId}`, async () => {
        await cancelFriendRequest(requestId);
        return "Friend request canceled";
      });
    },
    [runSocialMutation],
  );

  const handleDeleteFriend = useCallback(
    (userId: string) => {
      void runSocialMutation(`delete-friend:${userId}`, async () => {
        await deleteFriend(userId);
        return "Friend removed";
      });
    },
    [runSocialMutation],
  );

  const handleRotateFriendCode = useCallback(() => {
    void runSocialMutation("rotate-code", async () => {
      const user = await rotateFriendCode();
      onUserUpdated(user);
      return "Friend code rotated";
    });
  }, [onUserUpdated, runSocialMutation]);

  const handleInviteFriend = useCallback(
    (userId: string) => {
      if (selectedGroup === null) {
        return;
      }
      setInvitingUserId(userId);
      void runSocialMutation(`invite-friend:${userId}`, async () => {
        await createGroupInvite(selectedGroup.id, userId);
        return "Group invite sent";
      }).finally(() => setInvitingUserId(null));
    },
    [runSocialMutation, selectedGroup],
  );

  const handleCancelGroupInviteForCandidate = useCallback(
    (userId: string) => {
      if (selectedGroup === null) {
        return;
      }
      setInvitingUserId(userId);
      void runSocialMutation(`cancel-group-invite:${userId}`, async () => {
        await cancelGroupInvite(selectedGroup.id, userId);
        return "Group invite canceled";
      }).finally(() => setInvitingUserId(null));
    },
    [runSocialMutation, selectedGroup],
  );

  const handleAcceptGroupInvite = useCallback(
    (invite: GroupInvite) => {
      if (currentUser === null) {
        return;
      }
      const userId = currentUser.id;
      void runSocialMutation(`accept-group:${invite.group.id}`, async () => {
        await acceptGroupInvite(invite.group.id, userId);
        onGroupInviteAccepted(invite.group.id);
        return "Group invite accepted";
      });
    },
    [currentUser, onGroupInviteAccepted, runSocialMutation],
  );

  const handleDeclineGroupInvite = useCallback(
    (invite: GroupInvite) => {
      if (currentUser === null) {
        return;
      }
      const userId = currentUser.id;
      void runSocialMutation(`decline-group:${invite.group.id}`, async () => {
        await declineGroupInvite(invite.group.id, userId);
        return "Group invite declined";
      });
    },
    [currentUser, runSocialMutation],
  );

  const friendsPanelProps = useMemo<FriendsPanelProps>(
    () => ({
      user: currentUser,
      friendRequests,
      friends,
      groupInvites,
      loading: socialLoading,
      error: socialError,
      mutating: socialMutating,
      onAddFriend: handleAddFriend,
      onAcceptFriendRequest: handleAcceptFriendRequest,
      onDeclineFriendRequest: handleDeclineFriendRequest,
      onCancelFriendRequest: handleCancelFriendRequest,
      onDeleteFriend: handleDeleteFriend,
      onRotateFriendCode: handleRotateFriendCode,
      onAcceptGroupInvite: handleAcceptGroupInvite,
      onDeclineGroupInvite: handleDeclineGroupInvite,
    }),
    [
      currentUser,
      friendRequests,
      friends,
      groupInvites,
      handleAcceptFriendRequest,
      handleAcceptGroupInvite,
      handleAddFriend,
      handleCancelFriendRequest,
      handleDeclineFriendRequest,
      handleDeclineGroupInvite,
      handleDeleteFriend,
      handleRotateFriendCode,
      socialError,
      socialLoading,
      socialMutating,
    ],
  );

  const inviteCandidateProps = useMemo<InviteCandidateAdapterProps>(
    () => ({
      inviteCandidates,
      inviteCandidatesLoading,
      invitingUserId,
      onInviteFriend: handleInviteFriend,
      onCancelGroupInvite: handleCancelGroupInviteForCandidate,
    }),
    [
      handleCancelGroupInviteForCandidate,
      handleInviteFriend,
      inviteCandidates,
      inviteCandidatesLoading,
      invitingUserId,
    ],
  );

  return {
    friendsPanelProps,
    inviteCandidateProps,
  };
}
