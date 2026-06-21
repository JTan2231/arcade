package app

import "time"

type User struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	AvatarURL   *string   `json:"avatar_url,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Source struct {
	ID                     string    `json:"id"`
	Slug                   string    `json:"slug"`
	Name                   string    `json:"name"`
	BaseURL                string    `json:"base_url"`
	SupportsSubmissions    bool      `json:"supports_submissions"`
	SupportsProblemRatings bool      `json:"supports_problem_ratings"`
	SupportsTags           bool      `json:"supports_tags"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}

type ExternalAccount struct {
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	SourceID       string     `json:"source_id"`
	SourceSlug     string     `json:"source_slug"`
	SourceName     string     `json:"source_name"`
	ExternalHandle string     `json:"external_handle"`
	ExternalUserID *string    `json:"external_user_id,omitempty"`
	VerifiedAt     *time.Time `json:"verified_at,omitempty"`
	LastSyncedAt   *time.Time `json:"last_synced_at,omitempty"`
	SyncStatus     string     `json:"sync_status"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type Preference struct {
	ID                    string    `json:"id"`
	UserID                string    `json:"user_id"`
	SourceID              *string   `json:"source_id,omitempty"`
	SourceSlug            *string   `json:"source_slug,omitempty"`
	TargetDifficultyDelta int       `json:"target_difficulty_delta"`
	DailyProblemCount     int       `json:"daily_problem_count"`
	IncludeSolved         bool      `json:"include_solved"`
	PreferredTags         []string  `json:"preferred_tags"`
	BlockedTags           []string  `json:"blocked_tags"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

type Problem struct {
	ID              string     `json:"id"`
	SourceID        string     `json:"source_id"`
	SourceSlug      string     `json:"source_slug"`
	ExternalID      string     `json:"external_id"`
	Title           string     `json:"title"`
	URL             string     `json:"url"`
	ContestID       *string    `json:"contest_id,omitempty"`
	ProblemIndex    *string    `json:"problem_index,omitempty"`
	Rating          *int       `json:"rating,omitempty"`
	DifficultyLabel *string    `json:"difficulty_label,omitempty"`
	PublishedAt     *time.Time `json:"published_at,omitempty"`
	Tags            []string   `json:"tags"`
	SolvedByMe      bool       `json:"solved_by_me"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type Group struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Slug            string    `json:"slug"`
	Description     *string   `json:"description,omitempty"`
	Visibility      string    `json:"visibility"`
	CreatedByUserID string    `json:"created_by_user_id"`
	MyRole          *string   `json:"my_role,omitempty"`
	MyStatus        *string   `json:"my_status,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type GroupMember struct {
	UserID      string     `json:"user_id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"display_name"`
	AvatarURL   *string    `json:"avatar_url,omitempty"`
	Role        string     `json:"role"`
	Status      string     `json:"status"`
	JoinedAt    *time.Time `json:"joined_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type Division struct {
	ID              string         `json:"id"`
	GroupID         *string        `json:"group_id,omitempty"`
	Name            string         `json:"name"`
	Slug            string         `json:"slug"`
	Description     *string        `json:"description,omitempty"`
	CreatedByUserID *string        `json:"created_by_user_id,omitempty"`
	Rules           []DivisionRule `json:"rules"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

type DivisionRule struct {
	ID               string    `json:"id"`
	DivisionID       string    `json:"division_id"`
	SourceID         *string   `json:"source_id,omitempty"`
	SourceSlug       *string   `json:"source_slug,omitempty"`
	MinUserRating    *int      `json:"min_user_rating,omitempty"`
	MaxUserRating    *int      `json:"max_user_rating,omitempty"`
	MinProblemRating *int      `json:"min_problem_rating,omitempty"`
	MaxProblemRating *int      `json:"max_problem_rating,omitempty"`
	ProblemCount     *int      `json:"problem_count,omitempty"`
	RequiredTags     []string  `json:"required_tags"`
	ExcludedTags     []string  `json:"excluded_tags"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type DailySet struct {
	ID               string      `json:"id"`
	ScopeType        string      `json:"scope_type"`
	ScopeID          *string     `json:"scope_id,omitempty"`
	GroupID          *string     `json:"group_id,omitempty"`
	DivisionID       *string     `json:"division_id,omitempty"`
	UserID           *string     `json:"user_id,omitempty"`
	Date             string      `json:"date"`
	Title            *string     `json:"title,omitempty"`
	GenerationReason *string     `json:"generation_reason,omitempty"`
	GeneratorVersion *string     `json:"generator_version,omitempty"`
	Items            []DailyItem `json:"items"`
	CreatedAt        time.Time   `json:"created_at"`
}

type DailyItem struct {
	ID                   string    `json:"id"`
	DailySetID           string    `json:"daily_set_id"`
	Position             int       `json:"position"`
	Role                 string    `json:"role"`
	Points               int       `json:"points"`
	RecommendationReason *string   `json:"recommendation_reason,omitempty"`
	Problem              Problem   `json:"problem"`
	CreatedAt            time.Time `json:"created_at"`
}

type DailyFeed struct {
	ID                 string            `json:"id"`
	GroupID            string            `json:"group_id"`
	GroupName          *string           `json:"group_name,omitempty"`
	Name               string            `json:"name"`
	Slug               string            `json:"slug"`
	Description        *string           `json:"description,omitempty"`
	Enabled            bool              `json:"enabled"`
	Audience           DailyFeedAudience `json:"audience"`
	Schedule           DailyFeedSchedule `json:"schedule"`
	RulesSchemaVersion int               `json:"rules_schema_version"`
	Rules              DailyFeedRules    `json:"rules"`
	CreatedByUserID    *string           `json:"created_by_user_id,omitempty"`
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
}

type DailyFeedAudience struct {
	Type       string  `json:"type"`
	DivisionID *string `json:"division_id,omitempty"`
}

type DailyFeedSchedule struct {
	Cadence  string `json:"cadence"`
	Timezone string `json:"timezone"`
}

type DailyFeedRules struct {
	Blocks []DailyFeedRuleBlock `json:"blocks"`
}

type DailyFeedRuleBlock struct {
	Source  string           `json:"source"`
	Kind    string           `json:"kind"`
	Count   int              `json:"count"`
	Filters DailyFeedFilters `json:"filters,omitempty"`
	Roles   []string         `json:"roles,omitempty"`
	Points  []int            `json:"points,omitempty"`
}

type DailyFeedFilters struct {
	Rating *DailyFeedRatingFilter `json:"rating,omitempty"`
	Tags   *DailyFeedTagFilter    `json:"tags,omitempty"`
}

type DailyFeedRatingFilter struct {
	Min    *int `json:"min,omitempty"`
	Max    *int `json:"max,omitempty"`
	Target *int `json:"target,omitempty"`
}

type DailyFeedTagFilter struct {
	IncludeAny []string `json:"include_any,omitempty"`
	ExcludeAny []string `json:"exclude_any,omitempty"`
}

type DailyFeedOutput struct {
	FeedID    string                `json:"feed_id"`
	GroupID   string                `json:"group_id"`
	GroupName *string               `json:"group_name,omitempty"`
	Date      string                `json:"date"`
	Title     string                `json:"title"`
	Items     []DailyFeedOutputItem `json:"items"`
}

type DailyFeedOutputItem struct {
	Position int              `json:"position"`
	Role     string           `json:"role"`
	Points   int              `json:"points"`
	Reason   string           `json:"reason"`
	Item     DailyCatalogItem `json:"item"`
	Action   DailyFeedAction  `json:"action"`
}

type DailyCatalogItem struct {
	ID         string         `json:"id"`
	Source     string         `json:"source"`
	ExternalID string         `json:"external_id"`
	Kind       string         `json:"kind"`
	Title      string         `json:"title"`
	Metadata   map[string]any `json:"metadata"`
}

type DailyFeedAction struct {
	Type  string `json:"type"`
	Label string `json:"label"`
	URL   string `json:"url"`
}

type Submission struct {
	ID                   string    `json:"id"`
	UserID               string    `json:"user_id"`
	DisplayName          string    `json:"display_name"`
	ProblemID            string    `json:"problem_id"`
	ProblemTitle         string    `json:"problem_title"`
	SourceID             string    `json:"source_id"`
	SourceSlug           string    `json:"source_slug"`
	ExternalSubmissionID *string   `json:"external_submission_id,omitempty"`
	ExternalAccountID    *string   `json:"external_account_id,omitempty"`
	DailySetID           *string   `json:"daily_set_id,omitempty"`
	Verdict              string    `json:"verdict"`
	Language             *string   `json:"language,omitempty"`
	SubmittedAt          time.Time `json:"submitted_at"`
	RuntimeMS            *int      `json:"runtime_ms,omitempty"`
	MemoryBytes          *int      `json:"memory_bytes,omitempty"`
	CreatedAt            time.Time `json:"created_at"`
}

type LeaderboardRow struct {
	Rank         int        `json:"rank"`
	UserID       string     `json:"user_id"`
	DisplayName  string     `json:"display_name"`
	Points       float64    `json:"points"`
	Solves       int        `json:"solves"`
	LastSolvedAt *time.Time `json:"last_solved_at,omitempty"`
	StreakCount  *int       `json:"streak_count,omitempty"`
}
