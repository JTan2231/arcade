import type { GroupDashboardProps } from "../components/GroupDashboard";
import { matchesGrandchildState } from "../machines/stateMatches";
import type { DashboardContext } from "../machines/dashboardMachine";
import { postPath } from "../routes";
import { copyPublicPath } from "./copyPublicPath";
import { EMPTY_POSTS, EMPTY_POST_TAGS } from "./empty";
import type { DashboardActorRef, ToastCallback } from "./types";

type PostsProps = Pick<
  GroupDashboardProps,
  | "posts"
  | "postTags"
  | "postsLoading"
  | "postsError"
  | "postSubmitting"
  | "updatingPostId"
  | "deletingPostId"
  | "currentUserId"
  | "onCreateFeedPost"
  | "onUpdateFeedPost"
  | "onCopyPublicPostLink"
  | "onDeleteFeedPost"
>;

export function usePostsAdapter({
  dashboardRef,
  dashboardContext,
  dashboardStateValue,
  currentUserId,
  onToast,
}: {
  dashboardRef: DashboardActorRef | undefined;
  dashboardContext: DashboardContext | null;
  dashboardStateValue: unknown;
  currentUserId: string | null;
  onToast: ToastCallback;
}): PostsProps {
  const loadingPosts = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "loadingPosts");
  const creatingPost = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "creatingPost");
  const postMutation = dashboardContext?.postMutation ?? null;
  const updatingPostId = postMutation?.kind === "update" ? postMutation.postId : null;
  const deletingPostId = postMutation?.kind === "delete" ? postMutation.postId : null;

  return {
    posts: dashboardContext?.posts ?? EMPTY_POSTS,
    postTags: dashboardContext?.postTags ?? EMPTY_POST_TAGS,
    postsLoading: loadingPosts,
    postsError: dashboardContext?.postsError ?? "",
    postSubmitting: creatingPost,
    updatingPostId,
    deletingPostId,
    currentUserId,
    onCreateFeedPost: (payload) => dashboardRef?.send({ type: "POST_CREATE_SUBMITTED", payload }),
    onUpdateFeedPost: (postId, payload) => dashboardRef?.send({ type: "POST_UPDATE_SUBMITTED", postId, payload }),
    onCopyPublicPostLink: (postId) => void copyPublicPath(postPath(postId), "Post link copied", onToast),
    onDeleteFeedPost: (postId) => dashboardRef?.send({ type: "POST_DELETE_SUBMITTED", postId }),
  };
}
