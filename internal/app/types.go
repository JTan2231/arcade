package app

import "time"

type User struct {
	ID              string    `json:"id"`
	Email           string    `json:"email"`
	Username        string    `json:"username"`
	DisplayName     string    `json:"display_name"`
	AvatarURL       *string   `json:"avatar_url,omitempty"`
	ThemePreference string    `json:"theme_preference"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type PublicUser struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName string  `json:"display_name"`
	AvatarURL   *string `json:"avatar_url,omitempty"`
}

type Group struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Slug            string    `json:"slug"`
	Description     *string   `json:"description,omitempty"`
	Visibility      string    `json:"visibility"`
	JoinPolicy      string    `json:"join_policy"`
	CreatedByUserID string    `json:"created_by_user_id"`
	MyRole          *string   `json:"my_role,omitempty"`
	MyStatus        *string   `json:"my_status,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type PublicGroup struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Slug        string            `json:"slug"`
	Description *string           `json:"description,omitempty"`
	Visibility  string            `json:"visibility"`
	JoinPolicy  string            `json:"join_policy"`
	Feeds       []PublicGroupFeed `json:"feeds"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

type PublicGroupFeed struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Slug            string            `json:"slug"`
	Kind            string            `json:"kind"`
	Description     *string           `json:"description,omitempty"`
	Enabled         bool              `json:"enabled"`
	CaptionsEnabled bool              `json:"captions_enabled"`
	EvidenceFormat  EvidenceFormat    `json:"evidence_format"`
	Schedule        DailyFeedSchedule `json:"schedule"`
	CreatedAt       time.Time         `json:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"`
}

type PublicParentGroup struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Slug       string `json:"slug"`
	Visibility string `json:"visibility"`
	JoinPolicy string `json:"join_policy"`
}

type GroupMember struct {
	UserID      string                  `json:"user_id"`
	Username    string                  `json:"username"`
	DisplayName string                  `json:"display_name"`
	AvatarURL   *string                 `json:"avatar_url,omitempty"`
	Role        string                  `json:"role"`
	Status      string                  `json:"status"`
	JoinedAt    *time.Time              `json:"joined_at,omitempty"`
	InvitedBy   *PublicUser             `json:"invited_by,omitempty"`
	InvitedAt   *time.Time              `json:"invited_at,omitempty"`
	InviteLink  *GroupInviteLinkSummary `json:"invite_link,omitempty"`
	CreatedAt   time.Time               `json:"created_at"`
	UpdatedAt   time.Time               `json:"updated_at"`
}

type GroupInviteLinkSummary struct {
	ID    string  `json:"id"`
	Label *string `json:"label,omitempty"`
}

type GroupInviteLink struct {
	ID        string      `json:"id"`
	GroupID   string      `json:"group_id"`
	Label     *string     `json:"label,omitempty"`
	CreatedBy *PublicUser `json:"created_by,omitempty"`
	ExpiresAt time.Time   `json:"expires_at"`
	RevokedAt *time.Time  `json:"revoked_at,omitempty"`
	MaxUses   *int        `json:"max_uses,omitempty"`
	UseCount  int         `json:"use_count"`
	Token     *string     `json:"token,omitempty"`
	URLPath   *string     `json:"url_path,omitempty"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

type GroupInviteLinkPreview struct {
	Group     PublicParentGroup `json:"group"`
	CreatedBy *PublicUser       `json:"created_by,omitempty"`
	ExpiresAt time.Time         `json:"expires_at"`
	RevokedAt *time.Time        `json:"revoked_at,omitempty"`
	MaxUses   *int              `json:"max_uses,omitempty"`
	UseCount  int               `json:"use_count"`
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
	ID            string    `json:"id"`
	DivisionID    string    `json:"division_id"`
	MinUserRating *int      `json:"min_user_rating,omitempty"`
	MaxUserRating *int      `json:"max_user_rating,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
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
	CaptionsEnabled bool                  `json:"captions_enabled"`
	SourceID        *string               `json:"source_id,omitempty"`
	SourceName      *string               `json:"source_name,omitempty"`
	ItemCount       *int                  `json:"item_count,omitempty"`
	EvidenceFormat  EvidenceFormat        `json:"evidence_format"`
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

type DailyFeedEvent struct {
	ID              string                `json:"id"`
	GroupID         string                `json:"group_id"`
	FeedID          string                `json:"feed_id"`
	Name            string                `json:"name"`
	Description     *string               `json:"description,omitempty"`
	StartsOn        string                `json:"starts_on"`
	EndsOn          string                `json:"ends_on"`
	SourceID        string                `json:"source_id"`
	SourceName      string                `json:"source_name"`
	ItemCount       int                   `json:"item_count"`
	Filters         []DailyFeedRuleFilter `json:"filters"`
	Status          string                `json:"status"`
	CreatedByUserID *string               `json:"created_by_user_id,omitempty"`
	UpdatedByUserID *string               `json:"updated_by_user_id,omitempty"`
	CreatedAt       time.Time             `json:"created_at"`
	UpdatedAt       time.Time             `json:"updated_at"`
	SelectionSeed   string                `json:"selection_token"`
}

type DailyFeedOutputEvent struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	StartsOn string `json:"starts_on"`
	EndsOn   string `json:"ends_on"`
}

type DailyFeedOutput struct {
	FeedID     string                     `json:"feed_id"`
	GroupID    string                     `json:"group_id"`
	GroupName  *string                    `json:"group_name,omitempty"`
	Date       string                     `json:"date"`
	Title      string                     `json:"title"`
	Event      *DailyFeedOutputEvent      `json:"event,omitempty"`
	Generation *DailyFeedOutputGeneration `json:"generation,omitempty"`
	Items      []DailyFeedOutputItem      `json:"items"`
}

type DailyFeedOutputSummary struct {
	FeedID   string                `json:"feed_id"`
	Date     string                `json:"date"`
	Title    string                `json:"title"`
	Subtitle *string               `json:"subtitle,omitempty"`
	Event    *DailyFeedOutputEvent `json:"event,omitempty"`
}

type DailyFeedOutputGeneration struct {
	ID                string    `json:"id"`
	Number            int       `json:"number"`
	RefreshedByUserID *string   `json:"refreshed_by_user_id,omitempty"`
	RefreshedAt       time.Time `json:"refreshed_at"`
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

type PublicFeed struct {
	ID              string                 `json:"id"`
	Group           PublicParentGroup      `json:"group"`
	Name            string                 `json:"name"`
	Slug            string                 `json:"slug"`
	Kind            string                 `json:"kind"`
	Description     *string                `json:"description,omitempty"`
	Enabled         bool                   `json:"enabled"`
	CaptionsEnabled bool                   `json:"captions_enabled"`
	EvidenceFormat  EvidenceFormat         `json:"evidence_format"`
	Schedule        DailyFeedSchedule      `json:"schedule"`
	Date            string                 `json:"date"`
	Event           *DailyFeedOutputEvent  `json:"event,omitempty"`
	Items           []PublicFeedOutputItem `json:"items"`
	Posts           []PublicPost           `json:"posts"`
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
}

type PublicFeedOutputItem struct {
	Position int              `json:"position"`
	Title    string           `json:"title"`
	Action   PublicFeedAction `json:"action"`
}

type PublicFeedAction struct {
	Type  string `json:"type"`
	Label string `json:"label"`
	URL   string `json:"url,omitempty"`
	Text  string `json:"text,omitempty"`
}

type GroupFeedPost struct {
	ID                    string                `json:"id"`
	GroupID               string                `json:"group_id"`
	FeedInstanceID        string                `json:"feed_instance_id"`
	FeedID                string                `json:"feed_id"`
	FeedDate              string                `json:"feed_date"`
	AuthorUserID          string                `json:"author_user_id"`
	AuthorUsername        string                `json:"author_username"`
	AuthorDisplayName     string                `json:"author_display_name"`
	AuthorAvatarURL       *string               `json:"author_avatar_url,omitempty"`
	EvidenceText          string                `json:"evidence_text"`
	EvidenceFormat        EvidenceFormat        `json:"evidence_format"`
	EvidenceFormatVersion EvidenceFormatVersion `json:"evidence_format_version"`
	Caption               *string               `json:"caption,omitempty"`
	Tags                  []GroupPostTag        `json:"tags"`
	DeletedAt             *time.Time            `json:"deleted_at,omitempty"`
	CreatedAt             time.Time             `json:"created_at"`
	UpdatedAt             time.Time             `json:"updated_at"`
}

type GroupFeedPostRoute struct {
	GroupID  string `json:"group_id"`
	FeedID   string `json:"feed_id"`
	FeedDate string `json:"feed_date"`
}

type PublicPost struct {
	ID                    string                `json:"id"`
	Group                 PublicParentGroup     `json:"group"`
	Feed                  PublicPostFeed        `json:"feed"`
	FeedDate              string                `json:"feed_date"`
	Author                PublicUser            `json:"author"`
	EvidenceText          string                `json:"evidence_text"`
	EvidenceFormat        EvidenceFormat        `json:"evidence_format"`
	EvidenceFormatVersion EvidenceFormatVersion `json:"evidence_format_version"`
	Caption               *string               `json:"caption,omitempty"`
	Tags                  []PublicPostTag       `json:"tags"`
	CreatedAt             time.Time             `json:"created_at"`
	UpdatedAt             time.Time             `json:"updated_at"`
}

type PublicPostFeed struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type PublicPostTag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type GroupPostTag struct {
	ID              string     `json:"id"`
	GroupID         string     `json:"group_id"`
	Name            string     `json:"name"`
	DisplayOrder    int        `json:"display_order"`
	ArchivedAt      *time.Time `json:"archived_at,omitempty"`
	CreatedByUserID *string    `json:"created_by_user_id,omitempty"`
	UpdatedByUserID *string    `json:"updated_by_user_id,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type PostCardMaterialIntent struct {
	Model               string `json:"model"`
	SurfaceHue          int    `json:"surface_hue"`
	SurfaceColorfulness int    `json:"surface_colorfulness"`
	AccentHue           *int   `json:"accent_hue,omitempty"`
	AccentColorfulness  *int   `json:"accent_colorfulness,omitempty"`
}

type PostCardPaletteSummary struct {
	ID             string                 `json:"id"`
	SystemKey      *string                `json:"system_key,omitempty"`
	Name           string                 `json:"name"`
	MaterialIntent PostCardMaterialIntent `json:"material_intent"`
	ArchivedAt     *time.Time             `json:"archived_at,omitempty"`
	Revision       int64                  `json:"revision"`
}

type GroupPostCardPalette struct {
	PostCardPaletteSummary
	GroupID             string    `json:"group_id"`
	ActiveFormatCount   int       `json:"active_format_count"`
	ArchivedFormatCount int       `json:"archived_format_count"`
	CreatedByUserID     *string   `json:"created_by_user_id,omitempty"`
	UpdatedByUserID     *string   `json:"updated_by_user_id,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type EvidenceFormat struct {
	ID                   string                 `json:"id"`
	GroupID              string                 `json:"group_id,omitempty"`
	Slug                 string                 `json:"slug"`
	Name                 string                 `json:"name"`
	Description          *string                `json:"description,omitempty"`
	ContentTypeface      string                 `json:"content_typeface"`
	ContentCardPaletteID string                 `json:"content_card_palette_id"`
	ContentCardPalette   PostCardPaletteSummary `json:"content_card_palette"`
	ArchivedAt           *time.Time             `json:"archived_at,omitempty"`
	CreatedByUserID      *string                `json:"created_by_user_id,omitempty"`
	UpdatedByUserID      *string                `json:"updated_by_user_id,omitempty"`
	ActiveVersion        EvidenceFormatVersion  `json:"active_version"`
	AssignedFeedCount    int                    `json:"assigned_feed_count"`
	CreatedAt            time.Time              `json:"created_at"`
	UpdatedAt            time.Time              `json:"updated_at"`
}

type EvidenceFormatVersion struct {
	ID              string    `json:"id"`
	GroupID         string    `json:"group_id,omitempty"`
	FormatID        string    `json:"format_id"`
	VersionNumber   int       `json:"version_number"`
	MinChars        int       `json:"min_chars"`
	MaxChars        *int      `json:"max_chars,omitempty"`
	MinLines        *int      `json:"min_lines,omitempty"`
	MaxLines        *int      `json:"max_lines,omitempty"`
	ExactLines      *int      `json:"exact_lines,omitempty"`
	LineMinChars    *int      `json:"line_min_chars,omitempty"`
	LineMaxChars    *int      `json:"line_max_chars,omitempty"`
	AllowBlankLines bool      `json:"allow_blank_lines"`
	CreatedByUserID *string   `json:"created_by_user_id,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type FeedMetric struct {
	ID              string    `json:"id"`
	GroupID         string    `json:"group_id"`
	FeedID          string    `json:"feed_id"`
	SystemKey       string    `json:"system_key"`
	JudgmentPrompt  *string   `json:"judgment_prompt,omitempty"`
	Aggregation     string    `json:"aggregation"`
	DisplayName     string    `json:"display_name"`
	CreatedByUserID *string   `json:"created_by_user_id,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type FeedMetricJudgment struct {
	ID              string    `json:"id"`
	MetricID        string    `json:"metric_id"`
	GroupID         string    `json:"group_id"`
	PostID          string    `json:"post_id"`
	SubjectUserID   string    `json:"subject_user_id"`
	EvaluatorUserID string    `json:"evaluator_user_id"`
	Value           float64   `json:"value"`
	Note            *string   `json:"note,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type MetricLeaderboard struct {
	Metric FeedMetric             `json:"metric"`
	From   string                 `json:"from"`
	To     string                 `json:"to"`
	Rows   []MetricLeaderboardRow `json:"rows"`
}

type MetricLeaderboardRow struct {
	Rank        *int       `json:"rank"`
	User        PublicUser `json:"user"`
	Value       any        `json:"value"`
	RawValue    *float64   `json:"raw_value"`
	SampleCount int        `json:"sample_count"`
}

type CatalogSource struct {
	ID                string               `json:"id"`
	GroupID           *string              `json:"group_id,omitempty"`
	Slug              string               `json:"slug"`
	Scope             string               `json:"scope"`
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
	ExternalID    *string        `json:"external_id,omitempty"`
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

type DailyFeedEventPreview struct {
	SelectionToken      string                   `json:"selection_token"`
	Event               DailyFeedEvent           `json:"event"`
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
