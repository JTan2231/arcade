import type { GroupDashboardProps } from "../components/GroupDashboard";
import { matchesGrandchildState } from "../machines/stateMatches";
import type { DashboardContext } from "../machines/dashboardMachine";
import { EMPTY_POSTS, EMPTY_POST_TAGS } from "./empty";
import type { DashboardActorRef } from "./types";

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
  | "onDeleteFeedPost"
>;

export function usePostsAdapter({
  dashboardRef,
  dashboardContext,
  dashboardStateValue,
  currentUserId,
}: {
  dashboardRef: DashboardActorRef | undefined;
  dashboardContext: DashboardContext | null;
  dashboardStateValue: unknown;
  currentUserId: string | null;
}): PostsProps {
  const loadingPosts = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "loadingPosts");
  const loadingDatedPosts = matchesGrandchildState(
    dashboardStateValue,
    "groupSelected",
    "feedSelected",
    "loadingDatedPosts",
  );
  const creatingPost = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "creatingPost");
  const postMutation = dashboardContext?.postMutation ?? null;
  const updatingPostId = postMutation?.kind === "update" ? postMutation.postId : null;
  const deletingPostId = postMutation?.kind === "delete" ? postMutation.postId : null;

  return {
    posts: dashboardContext?.posts ?? EMPTY_POSTS,
    postTags: dashboardContext?.postTags ?? EMPTY_POST_TAGS,
    postsLoading: loadingPosts || loadingDatedPosts,
    postsError: dashboardContext?.postsError ?? "",
    postSubmitting: creatingPost,
    updatingPostId,
    deletingPostId,
    currentUserId,
    onCreateFeedPost: (payload) => dashboardRef?.send({ type: "POST_CREATE_SUBMITTED", payload }),
    onUpdateFeedPost: (postId, payload) => dashboardRef?.send({ type: "POST_UPDATE_SUBMITTED", postId, payload }),
    onDeleteFeedPost: (postId) => dashboardRef?.send({ type: "POST_DELETE_SUBMITTED", postId }),
  };
}
