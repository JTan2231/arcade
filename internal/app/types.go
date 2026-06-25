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
	ID              string                `json:"id"`
	GroupID         string                `json:"group_id"`
	GroupName       *string               `json:"group_name,omitempty"`
	Name            string                `json:"name"`
	Slug            string                `json:"slug"`
	Kind            string                `json:"kind"`
	Description     *string               `json:"description,omitempty"`
	Enabled         bool                  `json:"enabled"`
	SourceID        *string               `json:"source_id,omitempty"`
	SourceName      *string               `json:"source_name,omitempty"`
	ItemCount       *int                  `json:"item_count,omitempty"`
	Schedule        DailyFeedSchedule     `json:"schedule"`
	Filters         []DailyFeedRuleFilter `json:"filters"`
	CreatedByUserID *string               `json:"created_by_user_id,omitempty"`
	CreatedAt       time.Time             `json:"created_at"`
	UpdatedAt       time.Time             `json:"updated_at"`
}

type DailyFeedSchedule struct {
	StartsAt        time.Time `json:"starts_at"`
	Timezone        string    `json:"timezone"`
	IntervalSeconds int       `json:"interval_seconds"`
}

type DailyFeedRuleFilter struct {
	ID           string    `json:"id,omitempty"`
	FeedID       string    `json:"feed_id,omitempty"`
	SourceID     string    `json:"source_id,omitempty"`
	FieldID      string    `json:"field_id"`
	FieldKey     string    `json:"field_key,omitempty"`
	FieldLabel   string    `json:"field_label,omitempty"`
	ValueType    string    `json:"value_type,omitempty"`
	IsArray      bool      `json:"is_array,omitempty"`
	Position     int       `json:"position"`
	Op           string    `json:"op"`
	TextValues   []string  `json:"text_values,omitempty"`
	NumberValues []float64 `json:"number_values,omitempty"`
	CreatedAt    time.Time `json:"created_at,omitempty"`
	UpdatedAt    time.Time `json:"updated_at,omitempty"`
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
	SourceID   string         `json:"source_id"`
	SourceName string         `json:"source_name"`
	Title      string         `json:"title"`
	Data       map[string]any `json:"data"`
}

type DailyFeedAction struct {
	Type  string `json:"type"`
	Label string `json:"label"`
	URL   string `json:"url,omitempty"`
	Text  string `json:"text,omitempty"`
}

type GroupFeedPost struct {
	ID                string     `json:"id"`
	GroupID           string     `json:"group_id"`
	FeedInstanceID    string     `json:"feed_instance_id"`
	FeedID            string     `json:"feed_id"`
	FeedDate          string     `json:"feed_date"`
	AuthorUserID      string     `json:"author_user_id"`
	AuthorUsername    string     `json:"author_username"`
	AuthorDisplayName string     `json:"author_display_name"`
	AuthorAvatarURL   *string    `json:"author_avatar_url,omitempty"`
	EvidenceKind      string     `json:"evidence_kind"`
	EvidenceText      string     `json:"evidence_text"`
	Caption           *string    `json:"caption,omitempty"`
	DeletedAt         *time.Time `json:"deleted_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type CatalogSource struct {
	ID                string               `json:"id"`
	GroupID           string               `json:"group_id"`
	Name              string               `json:"name"`
	Template          string               `json:"template"`
	CreatedByUserID   *string              `json:"created_by_user_id,omitempty"`
	ItemCount         int                  `json:"item_count"`
	EligibleItemCount int                  `json:"eligible_item_count"`
	TemplateFields    []string             `json:"template_fields"`
	Fields            []CatalogSourceField `json:"fields"`
	CreatedAt         time.Time            `json:"created_at"`
	UpdatedAt         time.Time            `json:"updated_at"`
}

type CatalogSourceField struct {
	ID           string    `json:"id"`
	SourceID     string    `json:"source_id"`
	Key          string    `json:"key"`
	Label        string    `json:"label"`
	ValueType    string    `json:"value_type"`
	IsArray      bool      `json:"is_array"`
	DisplayOrder int       `json:"display_order"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type CatalogItem struct {
	ID            string         `json:"id"`
	SourceID      string         `json:"source_id"`
	Title         string         `json:"title,omitempty"`
	Data          map[string]any `json:"data"`
	Rendered      string         `json:"rendered"`
	MissingFields []string       `json:"missing_fields"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

type DailyFeedPreview struct {
	Output              DailyFeedOutput          `json:"output"`
	CandidateItemCount  int                      `json:"candidate_item_count"`
	EligibleItemCount   int                      `json:"eligible_item_count"`
	IneligibleItemCount int                      `json:"ineligible_item_count"`
	IneligibleItems     []CatalogItemEligibility `json:"ineligible_items"`
}

type CatalogItemEligibility struct {
	ID            string   `json:"id"`
	SourceID      string   `json:"source_id"`
	Title         string   `json:"title,omitempty"`
	MissingFields []string `json:"missing_fields"`
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
