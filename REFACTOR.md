# Frontend Refactor Plan

This refactor is a single implementation. The end state is smaller frontend
modules grouped by the state they own, the API writes they trigger, and the UI
they render. Do not leave compatibility wrappers, duplicate component copies, or
old helpers behind after the move.

## Goals

- Reduce `web/frontend/src/components/GroupDashboard.tsx` to a composition
  shell for the selected feed surface.
- Reduce `web/frontend/src/components/GroupSettingsDialog.tsx` to a composition
  shell for group settings.
- Reduce `web/frontend/src/machines/dashboardMachine.ts` by extracting actors,
  context defaults, and pure collection helpers while keeping one exported
  `dashboardMachine`.
- Preserve runtime behavior, route paths, API payload shapes, accessible labels,
  and CSS class names, and complete the listed schedule-settings wiring.
- Keep frontend visual output stable; selector moves are allowed, visual redesign
  is not part of this change.

## Required End State

The frontend source tree must contain these modules:

```text
web/frontend/src/components/dashboard/
  AddFeedDialog.tsx
  FeedOutput.tsx
  FeedPosts.tsx
  MetricsSection.tsx
  evidenceText.ts
  feedDraft.ts
  format.ts

web/frontend/src/components/groups/
  FeedSettingsDialog.tsx
  FeedSublist.tsx
  GroupsPanel.tsx

web/frontend/src/components/settings/
  EvidenceFormatManager.tsx
  GroupMembersManager.tsx
  GroupSettingsDialog.tsx
  GroupVisibilityControl.tsx
  InviteFriends.tsx
  PostTagManager.tsx
  evidenceFormatDraft.ts

web/frontend/src/machines/dashboard/
  actors.ts
  collections.ts
  context.ts
  events.ts
  guards.ts
```

Existing imports from these public component names must continue through
same-name exports:

- `GroupDashboard`
- `GroupsPanel`
- `GroupSettingsDialog`
- `MetricSettingsManager`

Do not create barrel files or a generic `utils.ts`. Import concrete modules.

## Dashboard Surface

Move these symbols out of `web/frontend/src/components/GroupDashboard.tsx`.

### Add Feed

Target file: `web/frontend/src/components/dashboard/AddFeedDialog.tsx`

Move:

- `AddFeedDialog`
- `FilterEditor`
- `FilterValueInput`
- `PreviewPanel`

Target file: `web/frontend/src/components/dashboard/feedDraft.ts`

Move:

- `FeedKind`
- `DraftFilter`
- `defaultTimezone`
- `defaultStartsAtInput`
- `datetimeLocalValue`
- `localInputToISOString`
- `operatorsForField`
- `defaultOperatorForField`
- `draftFilterToRequest`

State owned by `AddFeedDialog` remains local:

- `kind`
- `name`
- `description`
- `enabled`
- `sourceId`
- `evidenceFormatId`
- `itemCount`
- `startsAt`
- `timezone`
- `intervalSeconds`
- `filters`
- `validationError`

Remote state remains owned by `addFeedMachine` and passed through
`useAddFeedAdapter`:

- `addFeedOpen`
- `addFeedSources`
- `addFeedEvidenceFormats`
- `addFeedSourcesLoading`
- `addFeedPreview`
- `addFeedPreviewLoading`
- `addFeedSaving`
- `addFeedError`

Event callbacks remain unchanged:

- `onCloseAddFeed`
- `onAddFeedDraftChanged`
- `onPreviewFeed`
- `onCreateFeed`

### Feed Output

Target file: `web/frontend/src/components/dashboard/FeedOutput.tsx`

Move:

- `FeedOutput`
- `FeedOutputStatus`
- `LoadedFeedOutput`
- `FeedOutputTitleMenu`
- `OutputItem`
- `OutputItemTitle`

Target file: `web/frontend/src/components/dashboard/format.ts`

Move:

- `feedOutputSummary`
- `outputItemDisplayTitle`
- `primitiveDisplay`
- `firstNonEmpty`
- `formatDateTime`

State owned by `FeedOutputTitleMenu` remains local:

- `menuOpen`
- `summariesByDate`
- `historyLoading`

Dashboard machine state used by this group:

- `selectedFeedDate`
- `output`
- `outputError`

Adapter state used by this group:

- `outputLoading`
- `loadFeedOutputSummaries`

Callbacks remain unchanged:

- `onChangeFeedDate`

### Posts, Tags, and Evidence Display

Target file: `web/frontend/src/components/dashboard/FeedPosts.tsx`

Move:

- `FeedPostSection`
- `FeedPostCard`
- `PostTagMenu`
- `PostTagPills`
- `MetricJudgmentForm`
- `EvidenceCodeBlock`

Target file: `web/frontend/src/components/dashboard/evidenceText.ts`

Move:

- `normalizeEvidenceText`
- `validateEvidenceText`
- `evidenceFormatConstraintSummary`
- `shouldShowPostFormat`

Target file: `web/frontend/src/components/dashboard/format.ts`

Move:

- `selectedActivePostTagIDs`
- `sameStringSet`

State owned by `FeedPostSection` remains local:

- `formOpen`
- `evidenceText`
- `caption`
- `formError`

State owned by `FeedPostCard` remains local:

- `editing`
- `tagMenuOpen`
- `evidenceText`
- `caption`
- `formError`
- `selectedTagIds`
- `initialTagIds`
- `submittedUpdate`

State owned by `MetricJudgmentForm` remains local:

- `value`
- `note`
- `error`

State owned by `EvidenceCodeBlock` remains local:

- `expanded`

Dashboard machine state used by this group:

- `posts`
- `postsError`
- `postMutation`
- `postTags`

Adapter state used by this group:

- `postsLoading`
- `postSubmitting`
- `updatingPostId`
- `deletingPostId`
- `judgingPostId`
- `currentUserId`

Callbacks remain unchanged:

- `onCreateFeedPost`
- `onUpdateFeedPost`
- `onCopyPublicPostLink`
- `onDeleteFeedPost`
- `onCreateMetricJudgment`

### Metrics Rail

Target file: `web/frontend/src/components/dashboard/MetricsSection.tsx`

Move:

- `MetricsSection`
- `LeaderboardTable`
- `leaderboardValueColumnLabel`
- `leaderboardRankDisplay`
- `publicUserDisplayName`

State owned by `MetricsSection` remains local:

- `metricMenuOpen`

Dashboard machine state used by this group:

- `metrics`
- `selectedMetricId`
- `metricLeaderboard`
- `metricsError`

Adapter state used by this group:

- `metricsLoading`
- `leaderboardLoading`

Callbacks remain unchanged:

- `onSelectMetric`
- `onAddMetric`

## Groups Navigation and Feed Settings

Move the current groups navigation files into
`web/frontend/src/components/groups/`.

Target file: `web/frontend/src/components/groups/GroupsPanel.tsx`

Move:

- `GroupsPanel`
- `canManageGroup`
- `groupActions`

Target file: `web/frontend/src/components/groups/FeedSublist.tsx`

Move:

- `FeedSublist`

State owned by `FeedSublist` remains local:

- `settingsFeedId`

Target file: `web/frontend/src/components/groups/FeedSettingsDialog.tsx`

Move:

- `FeedSettingsDialog`
- `evidenceFormatSummary`

The feed settings module must include the schedule settings already represented
by machine events:

- `pendingFeedScheduleFeedId`
- `onChangeFeedSchedule`
- `FEED_SCHEDULE_CHANGED`
- `feedScheduleMutation`

`GroupsPanelProps` must declare:

- `pendingFeedScheduleFeedId: string | null`
- `onChangeFeedSchedule: (feedId: string, schedule: DailyFeedSchedule) => void`

`FeedSublist` must include `pendingFeedScheduleFeedId === feed.id` in its
`mutating` calculation.

`FeedSettingsDialog` must render schedule controls backed by `feed.schedule` and
submit a full `DailyFeedSchedule` through `onChangeFeedSchedule`. The controls
must edit:

- `starts_at`
- `timezone`
- `interval_seconds`

Use the existing frontend request shape from `PatchDailyFeedRequest.schedule`.
Do not add a second schedule payload type.

## Group Settings

Move these symbols out of
`web/frontend/src/components/GroupSettingsDialog.tsx`.

Target file: `web/frontend/src/components/settings/GroupSettingsDialog.tsx`

Keep:

- `GroupSettingsDialog`

The component only composes the sub-sections and passes props.

Target file: `web/frontend/src/components/settings/GroupVisibilityControl.tsx`

Move:

- `GroupVisibilityControl`

Target file: `web/frontend/src/components/settings/PostTagManager.tsx`

Move:

- `PostTagManager`
- `PostTagManagerRow`

State remains local:

- `PostTagManager`: `name`, `formError`
- `PostTagManagerRow`: `name`, `formError`

Target file: `web/frontend/src/components/settings/EvidenceFormatManager.tsx`

Move:

- `EvidenceFormatManager`
- `EvidenceFormatManagerRow`
- `EvidenceFormatConstraintFields`

Target file: `web/frontend/src/components/settings/evidenceFormatDraft.ts`

Move:

- `EvidenceFormatDraft`
- `emptyFormatDraft`
- `buildFormatPayload`
- `buildVersionPayload`
- `parsePositiveInteger`
- `parseOptionalPositiveInteger`
- `formatVersionToDraft`
- `versionPayload`
- `formatConstraintSummary`

State remains local:

- `EvidenceFormatManager`: `draft`, `formError`
- `EvidenceFormatManagerRow`: `name`, `description`, `draft`, `formError`

Target file: `web/frontend/src/components/settings/GroupMembersManager.tsx`

Move:

- `GroupMembersManager`
- `canRemoveMember`
- `roleLabel`
- `statusLabel`

Target file: `web/frontend/src/components/settings/InviteFriends.tsx`

Move:

- `InviteFriends`

`MetricSettingsManager` already lives in its own file. Keep it there.

## Dashboard Machine

Keep `web/frontend/src/machines/dashboardMachine.ts` as the single file that
exports `dashboardMachine` and `DashboardContext`.

Move supporting definitions into `web/frontend/src/machines/dashboard/`.

Target file: `events.ts`

Move:

- `CreatePostPayload`
- `UpdatePostPayload`
- `PostMutation`
- `PostTagMutation`
- `EvidenceFormatMutation`
- `FeedFormatMutation`
- `FeedScheduleMutation`
- `GroupMemberMutation`
- `GroupVisibilityMutation`
- `MetricMutation`
- `JudgmentMutation`
- `DashboardInput`
- `DashboardUserEvent`
- `DashboardOutputEvent`
- `DashboardEvent`
- actor input/output types such as `FeedInput`, `GroupWorkspaceInput`,
  `GroupWorkspaceOutput`, `DatedFeedInput`, `MetricInput`,
  `ToggleFeedInput`, `ChangeFeedFormatInput`, `ChangeFeedScheduleInput`,
  `UpdateGroupVisibilityInput`, `DeleteGroupOutput`,
  `DeleteGroupMemberOutput`, `DeleteFeedOutput`, `CreatePostInput`,
  `UpdatePostInput`, `DeletePostOutput`, `CreatePostTagInput`,
  `UpdatePostTagInput`, `CreateEvidenceFormatInput`,
  `UpdateEvidenceFormatInput`, `CreateEvidenceFormatVersionInput`,
  `CreateMetricInput`, `UpdateMetricInput`, `DeleteMetricOutput`,
  `CreateJudgmentInput`, `UpdateJudgmentInput`, `DeleteJudgmentInput`

Target file: `actors.ts`

Move the `dashboardSetup` `actors` object into a typed `dashboardActors`
export:

- `addFeedMachine`
- `listGroups`
- `createGroup`
- `updateGroupVisibility`
- `deleteGroup`
- `deleteGroupMember`
- `loadGroupWorkspace`
- `getGroupDailyFeedToday`
- `getGroupDailyFeedOutput`
- `listGroupFeedPosts`
- `listFeedMetrics`
- `getFeedMetric`
- `getMetricLeaderboard`
- `toggleFeed`
- `changeFeedFormat`
- `changeFeedSchedule`
- `refreshFeedGeneration`
- `deleteFeed`
- `createGroupFeedPost`
- `updateGroupFeedPost`
- `deleteGroupFeedPost`
- `createGroupPostTag`
- `updateGroupPostTag`
- `deleteGroupPostTag`
- `createGroupEvidenceFormat`
- `updateGroupEvidenceFormat`
- `createGroupEvidenceFormatVersion`
- `deleteGroupEvidenceFormat`
- `createFeedMetric`
- `updateFeedMetric`
- `deleteFeedMetric`
- `createFeedMetricJudgment`
- `updateFeedMetricJudgment`
- `deleteFeedMetricJudgment`

Target file: `guards.ts`

Move the guard implementations:

- `isUnauthorizedError`
- `hasSelectedGroup`
- `hasSelectedFeed`
- `hasLoadedOutput`
- `hasSelectedMetric`
- `hasRestorableFeed`
- `hasRestorableGroup`

Target file: `context.ts`

Move:

- `initialDashboardContext`
- `resetSelectedGroupContext`
- `resetMetricContext`
- `chooseGroupId`
- `chooseMetricId`
- `selectedGroupCanManage`
- `validPostUpdatePayload`

Target file: `collections.ts`

Move:

- `replaceFeed`
- `removeFeed`
- `upsertPost`
- `upsertPostTag`
- `upsertEvidenceFormat`
- `updateEvidenceFormatAssignedFeedCount`
- `updateEvidenceFormatFeedCountsForFeedChange`
- `upsertMetric`
- `replaceMetric`
- `removeMetric`
- `selectedMetricAfterDelete`
- `metricSort`
- `postTagSort`
- `evidenceFormatSort`
- `normalizeEvidenceFormatCreatePayload`

Keep transition builders and `sendParent` action factories in
`dashboardMachine.ts`. The statechart remains one machine definition.

## CSS

Split `web/frontend/src/styles.css` into an import entrypoint plus scoped CSS
files. Preserve selector order by importing files in this order:

```css
@import "./styles/tokens.css";
@import "./styles/base.css";
@import "./styles/layout.css";
@import "./styles/auth.css";
@import "./styles/public.css";
@import "./styles/groups.css";
@import "./styles/settings.css";
@import "./styles/dashboard.css";
@import "./styles/metrics.css";
@import "./styles/posts.css";
@import "./styles/output.css";
@import "./styles/feedback.css";
@import "./styles/responsive.css";
```

Move selectors by ownership:

- `tokens.css`: `:root`
- `base.css`: global element rules and shared form/control primitives
- `layout.css`: `.app-header`, `.layout`, `.group-layout`, `.sidebar-stack`,
  `.panel`, common row/nav/menu primitives
- `auth.css`: `.auth-*`
- `public.css`: `.public-*`
- `groups.css`: `.groups-panel`, `.group-tree`, `.feed-sublist`,
  `.feed-branch`, `.group-add-form`
- `settings.css`: `.group-settings-*`, `.feed-settings-*`,
  `.group-visibility-section`, `.group-members-*`, `.invite-friends-*`,
  `.post-tag-manager-*`, `.evidence-format-*`
- `dashboard.css`: `.group-dashboard-*`, `.dashboard-section`,
  `.feed-output-section`, `.feed-route-header`, `.date-control`,
  `.output-actions`, `.feed-filters-section`, `.preview-*`
- `metrics.css`: `.metrics-section`, `.metric-*`, `.leaderboard-*`
- `posts.css`: `.feed-post*`, `.post-*`, `.evidence-*`, `.caption-*`,
  `.post-tag-menu*`, `.post-tag-pill*`
- `output.css`: `.output-*`, `.prompt-details`, output animation keyframes
- `feedback.css`: `#toast`, `.form-error`, `.empty-state`
- `responsive.css`: all media queries

Do not rename CSS classes during this refactor. Do not change token values.

## Import Compatibility

After moving component files, update imports in:

- `web/frontend/src/workspace/GroupDashboardAdapter.tsx`
- `web/frontend/src/workspace/GroupsNavAdapter.tsx`
- `web/frontend/src/workspace/GroupSettingsAdapter.tsx`
- `web/frontend/src/components/PublicPages.tsx`
- any tests or locator code importing moved components or helpers

Keep type-only imports type-only.

## Validation

Run the full project validation after the refactor:

```sh
./ci.sh
```

Run locator checks for the affected frontend regions:

```sh
./locator.ts
```

Use targeted locator renders for:

- group navigation with feed action menu open
- feed settings dialog
- group settings dialog
- add-feed dialog
- selected feed output title/date menu
- posts section with create form
- post card with edit form and tag menu
- metric rail with metric menu
- leaderboard table

The implementation is complete only when `./ci.sh` passes and locator output
shows the same reachable UI regions after the module split.

## Non-Goals

- Do not redesign the UI.
- Do not change API routes.
- Do not change backend behavior.
- Do not rename persisted types.
- Do not replace XState.
- Do not split `api.ts` in this refactor.
- Do not introduce new state management libraries.
