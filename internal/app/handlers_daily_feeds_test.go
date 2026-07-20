package app

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func TestRenderCatalogTemplate(t *testing.T) {
	rendered, missing := renderCatalogTemplate(
		"https://codeforces.com/problemset/problem/{contest_id}/{index}",
		map[string]any{
			"name":       "Watermelon",
			"contest_id": "4",
			"index":      "A",
		},
	)

	if len(missing) != 0 {
		t.Fatalf("missing fields = %v", missing)
	}
	if rendered != "https://codeforces.com/problemset/problem/4/A" {
		t.Fatalf("rendered = %q", rendered)
	}
}

func TestRenderCatalogTemplateReportsMissingFields(t *testing.T) {
	_, missing := renderCatalogTemplate(
		"Practice {name}. Focus on {focus}. Drill: {drill}.",
		map[string]any{"name": "Jin Kazama", "focus": "electric execution"},
	)

	if !reflect.DeepEqual(missing, []string{"drill"}) {
		t.Fatalf("missing fields = %v", missing)
	}
}

func TestResolveDailyActionExternalURL(t *testing.T) {
	candidate := dailyCatalogCandidate{
		Rendered: "https://codeforces.com/problemset/problem/4/A",
	}

	action, ok := resolveDailyAction(candidate)
	if !ok {
		t.Fatal("resolveDailyAction rejected valid HTTPS output")
	}
	if action.URL != "https://codeforces.com/problemset/problem/4/A" {
		t.Fatalf("action URL = %q", action.URL)
	}
	if action.Label != "Open" {
		t.Fatalf("action label = %q", action.Label)
	}
}

func TestResolveDailyActionText(t *testing.T) {
	candidate := dailyCatalogCandidate{
		Rendered: "Practice Jin Kazama. Focus on electric execution.",
	}

	action, ok := resolveDailyAction(candidate)
	if !ok {
		t.Fatal("resolveDailyAction rejected text output")
	}
	if action.Type != "text" {
		t.Fatalf("action type = %q", action.Type)
	}
	if action.Text != "Practice Jin Kazama. Focus on electric execution." {
		t.Fatalf("action text = %q", action.Text)
	}
}

func TestDailyCandidateMatchesMetadataFilters(t *testing.T) {
	candidate := dailyCatalogCandidate{
		Data: map[string]any{
			"rating": float64(1000),
			"tags":   []any{"implementation", "math"},
		},
	}
	filters := []DailyFeedRuleFilter{
		{
			FieldKey:     "rating",
			FieldLabel:   "Rating",
			ValueType:    "number",
			Op:           "between",
			NumberValues: []float64{800, 1200},
		},
		{
			FieldKey:   "tags",
			FieldLabel: "Tags",
			ValueType:  "string",
			IsArray:    true,
			Op:         "contains",
			TextValues: []string{"implementation"},
		},
	}

	if !dailyCandidateMatchesFilters(candidate, filters) {
		t.Fatal("candidate should match rating and tag filters")
	}

	filters[1].TextValues = []string{"geometry"}
	if dailyCandidateMatchesFilters(candidate, filters) {
		t.Fatal("candidate should not match missing tag")
	}
}

func TestSortDailyCandidatesIsStableForSameInputs(t *testing.T) {
	candidates := []dailyCatalogCandidate{
		{ID: "item-a", Data: map[string]any{"rating": float64(1000)}},
		{ID: "item-b", Data: map[string]any{"rating": float64(1000)}},
		{ID: "item-c", Data: map[string]any{"rating": float64(1000)}},
	}
	first := append([]dailyCatalogCandidate(nil), candidates...)
	second := append([]dailyCatalogCandidate(nil), candidates...)

	sortDailyCandidates(first, "feed", "2026-06-21", "")
	sortDailyCandidates(second, "feed", "2026-06-21", "")

	if !reflect.DeepEqual(candidateIDs(first), candidateIDs(second)) {
		t.Fatalf("same inputs produced different orders: %v vs %v", candidateIDs(first), candidateIDs(second))
	}
}

func TestStableDailyHashPreservesLegacyInputWithoutGenerationSeed(t *testing.T) {
	const legacyHash = uint64(1789217096821911317)

	if got := stableDailyHash("feed", "2026-06-21", "", "item-a"); got != legacyHash {
		t.Fatalf("hash = %d, want %d", got, legacyHash)
	}
}

func TestStableDailyHashChangesWithGenerationSeed(t *testing.T) {
	legacy := stableDailyHash("feed", "2026-06-21", "", "item-a")
	refreshed := stableDailyHash("feed", "2026-06-21", "seed-one", "item-a")

	if refreshed == legacy {
		t.Fatal("generation seed did not change hash")
	}
}

func TestSortDailyCandidatesUsesGenerationSeed(t *testing.T) {
	candidates := []dailyCatalogCandidate{
		{ID: "item-a", Data: map[string]any{"rating": float64(1000)}},
		{ID: "item-b", Data: map[string]any{"rating": float64(1000)}},
		{ID: "item-c", Data: map[string]any{"rating": float64(1000)}},
		{ID: "item-d", Data: map[string]any{"rating": float64(1000)}},
	}
	defaultOrder := append([]dailyCatalogCandidate(nil), candidates...)
	refreshedOrder := append([]dailyCatalogCandidate(nil), candidates...)

	sortDailyCandidates(defaultOrder, "feed", "2026-06-21", "")
	sortDailyCandidates(refreshedOrder, "feed", "2026-06-21", "seed-one")

	if reflect.DeepEqual(candidateIDs(defaultOrder), candidateIDs(refreshedOrder)) {
		t.Fatalf("seeded sort matched default order: %v", candidateIDs(defaultOrder))
	}
}

func TestCombineDailyFeedSelectionSeedsPreservesSingleSeed(t *testing.T) {
	if got := combineDailyFeedSelectionSeeds("event-seed", ""); got != "event-seed" {
		t.Fatalf("event-only seed = %q", got)
	}
	if got := combineDailyFeedSelectionSeeds("", "generation-seed"); got != "generation-seed" {
		t.Fatalf("generation-only seed = %q", got)
	}
	if got := combineDailyFeedSelectionSeeds("", ""); got != "" {
		t.Fatalf("empty seed = %q", got)
	}
}

func TestCombineDailyFeedSelectionSeedsCombinesEventAndGeneration(t *testing.T) {
	combined := combineDailyFeedSelectionSeeds("event-seed", "generation-seed")
	if combined == "" || combined == "event-seed" || combined == "generation-seed" {
		t.Fatalf("combined seed = %q", combined)
	}
	if combined != combineDailyFeedSelectionSeeds("event-seed", "generation-seed") {
		t.Fatal("combined seed is not deterministic")
	}
}

func TestDailyFeedDefaults(t *testing.T) {
	if got := dailyFeedRole(0, 1); got != "target" {
		t.Fatalf("single item role = %q", got)
	}
	if got := dailyFeedRole(3, 4); got != "bonus" {
		t.Fatalf("fourth item role = %q", got)
	}
}

func TestDailyFeedKindDefaultsToCatalogDaily(t *testing.T) {
	kind, err := normalizeDailyFeedKind("")
	if err != nil {
		t.Fatalf("normalizeDailyFeedKind returned error: %v", err)
	}
	if kind != dailyFeedKindCatalogDaily {
		t.Fatalf("kind = %q", kind)
	}
}

func TestDailyFeedCaptionsDefaultEnabledAndCanBeDisabled(t *testing.T) {
	server := &Server{}
	input, err := server.normalizeCreateDailyFeed(context.Background(), "group", createDailyFeedRequest{
		Kind: dailyFeedKindDailyThread,
	})
	if err != nil {
		t.Fatalf("normalizeCreateDailyFeed returned error: %v", err)
	}
	if !input.CaptionsEnabled {
		t.Fatal("captions should default to enabled")
	}

	disabled := false
	input, err = server.normalizeCreateDailyFeed(context.Background(), "group", createDailyFeedRequest{
		Kind:            dailyFeedKindDailyThread,
		CaptionsEnabled: &disabled,
	})
	if err != nil {
		t.Fatalf("normalizeCreateDailyFeed returned error: %v", err)
	}
	if input.CaptionsEnabled {
		t.Fatal("explicitly disabled captions were enabled")
	}
}

func TestDailyThreadRejectsPracticeFields(t *testing.T) {
	server := &Server{}
	input, err := server.normalizeCreateDailyFeed(context.Background(), "group", createDailyFeedRequest{
		Kind: dailyFeedKindDailyThread,
	})
	if err != nil {
		t.Fatalf("normalizeCreateDailyFeed returned error: %v", err)
	}
	if input.Kind != dailyFeedKindDailyThread {
		t.Fatalf("kind = %q", input.Kind)
	}

	_, err = server.normalizeCreateDailyFeed(context.Background(), "group", createDailyFeedRequest{
		Kind:      dailyFeedKindDailyThread,
		SourceID:  "source",
		ItemCount: 1,
	})
	if err == nil {
		t.Fatal("expected daily thread to reject practice fields")
	}
}

func TestDailyThreadOutputHasNoGeneratedItems(t *testing.T) {
	server := &Server{}
	requestedDate := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	output, err := server.generateDailyFeedOutputForFeed(context.Background(), DailyFeed{
		ID:      "feed-id",
		GroupID: "group-id",
		Name:    defaultDailyThreadFeedName,
		Slug:    defaultDailyThreadFeedSlug,
		Kind:    dailyFeedKindDailyThread,
		Schedule: DailyFeedSchedule{
			StartsAt:        time.Date(2026, 6, 24, 0, 0, 0, 0, time.UTC),
			Timezone:        "UTC",
			IntervalSeconds: 86400,
		},
	}, &requestedDate)
	if err != nil {
		t.Fatalf("generateDailyFeedOutputForFeed returned error: %v", err)
	}
	if output.Title != defaultDailyThreadFeedName {
		t.Fatalf("title = %q", output.Title)
	}
	if output.Date != "2026-06-24" {
		t.Fatalf("date = %q", output.Date)
	}
	if len(output.Items) != 0 {
		t.Fatalf("items = %d", len(output.Items))
	}
}

func TestPublicFeedOutputItemsSanitizeCatalogData(t *testing.T) {
	items := publicFeedOutputItems([]DailyFeedOutputItem{
		{
			Position: 1,
			Item: DailyCatalogItem{
				ID:         "item-id",
				SourceID:   "source-id",
				SourceName: "Source",
				Title:      "Rendered Title",
				Data:       map[string]any{"rating": float64(800)},
			},
			Action: DailyFeedAction{
				Type:  "external_url",
				Label: "Open",
				URL:   "https://example.test/item",
			},
		},
	})

	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	if items[0].Title != "Rendered Title" {
		t.Fatalf("title = %q, want Rendered Title", items[0].Title)
	}
	if items[0].Action.Type != "link" {
		t.Fatalf("action type = %q, want link", items[0].Action.Type)
	}
	if items[0].Action.URL != "https://example.test/item" {
		t.Fatalf("action url = %q", items[0].Action.URL)
	}
}

func TestDailyFeedOutputDateKeepsRequestedCalendarDateInScheduleTimezone(t *testing.T) {
	requestedDate, err := parseDailyFeedPathDate("2026-06-28")
	if err != nil {
		t.Fatalf("parseDailyFeedPathDate returned error: %v", err)
	}

	date, err := dailyFeedOutputDate(DailyFeedSchedule{
		Timezone:        "America/Chicago",
		IntervalSeconds: 86400,
	}, &requestedDate)
	if err != nil {
		t.Fatalf("dailyFeedOutputDate returned error: %v", err)
	}

	if got := date.Format(dailyFeedDateLayout); got != "2026-06-28" {
		t.Fatalf("date = %q", got)
	}
	if got := date.Location().String(); got != "America/Chicago" {
		t.Fatalf("location = %q", got)
	}
}

func TestDailyFeedOutputDateBeforeFutureStartUsesTodayInScheduleTimezone(t *testing.T) {
	location, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatalf("time.LoadLocation returned error: %v", err)
	}

	date, err := dailyFeedOutputDateAt(DailyFeedSchedule{
		StartsAt:        time.Date(2026, 7, 3, 8, 0, 0, 0, location),
		Timezone:        "America/Chicago",
		IntervalSeconds: 86400,
	}, nil, time.Date(2026, 7, 2, 18, 0, 0, 0, location))
	if err != nil {
		t.Fatalf("dailyFeedOutputDateAt returned error: %v", err)
	}

	if got := date.Format(dailyFeedDateLayout); got != "2026-07-02" {
		t.Fatalf("date = %q", got)
	}
	if got := date.Location().String(); got != "America/Chicago" {
		t.Fatalf("location = %q", got)
	}
}

func TestDailyFeedOutputSummaryDatesStopAtLatestScheduleBoundary(t *testing.T) {
	location, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatalf("time.LoadLocation returned error: %v", err)
	}

	server := &Server{}
	feed := DailyFeed{
		ID:        "feed-id",
		CreatedAt: time.Date(2026, 7, 18, 9, 0, 0, 0, location),
		Schedule: DailyFeedSchedule{
			StartsAt:        time.Date(2026, 7, 18, 8, 0, 0, 0, location),
			Timezone:        "America/Chicago",
			IntervalSeconds: 86400,
		},
	}

	tests := []struct {
		name string
		now  time.Time
		want []string
	}{
		{
			name: "before today's boundary",
			now:  time.Date(2026, 7, 20, 0, 30, 0, 0, location),
			want: []string{"2026-07-19", "2026-07-18"},
		},
		{
			name: "after today's boundary",
			now:  time.Date(2026, 7, 20, 8, 1, 0, 0, location),
			want: []string{"2026-07-20", "2026-07-19", "2026-07-18"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dates, err := server.dailyFeedOutputSummaryDates(context.Background(), feed, "2026-07-20", test.now)
			if err != nil {
				t.Fatalf("dailyFeedOutputSummaryDates returned error: %v", err)
			}
			got := make([]string, 0, len(dates))
			for _, date := range dates {
				got = append(got, date.Format(dailyFeedDateLayout))
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("dates = %v, want %v", got, test.want)
			}
		})
	}
}

func TestNormalizeDailyFeedScheduleRejectsFutureStartDate(t *testing.T) {
	location, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatalf("time.LoadLocation returned error: %v", err)
	}
	tomorrow := time.Now().In(location).AddDate(0, 0, 1)

	_, err = normalizeDailyFeedSchedule(&DailyFeedSchedule{
		StartsAt:        time.Date(tomorrow.Year(), tomorrow.Month(), tomorrow.Day(), 8, 0, 0, 0, location),
		Timezone:        "America/Chicago",
		IntervalSeconds: 86400,
	})
	if err == nil {
		t.Fatal("expected future schedule start date to be rejected")
	}
}

func TestEffectiveDailyFeedScheduleUsesLatestVersionForCurrentOutput(t *testing.T) {
	location, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatalf("time.LoadLocation returned error: %v", err)
	}
	versions := []dailyFeedScheduleVersion{
		{
			Schedule: DailyFeedSchedule{
				StartsAt:        time.Date(2026, 7, 1, 8, 0, 0, 0, location),
				Timezone:        "America/Chicago",
				IntervalSeconds: 86400,
			},
		},
		{
			Schedule: DailyFeedSchedule{
				StartsAt:        time.Date(2026, 7, 4, 15, 30, 0, 0, location),
				Timezone:        "America/Chicago",
				IntervalSeconds: 7 * 86400,
			},
		},
	}

	schedule, err := effectiveDailyFeedScheduleFromVersions(
		versions,
		DailyFeedSchedule{},
		nil,
		time.Date(2026, 7, 5, 9, 0, 0, 0, location),
	)
	if err != nil {
		t.Fatalf("effectiveDailyFeedScheduleFromVersions returned error: %v", err)
	}
	if schedule.IntervalSeconds != 7*86400 {
		t.Fatalf("interval = %d, want weekly", schedule.IntervalSeconds)
	}
	if !schedule.StartsAt.Equal(versions[1].Schedule.StartsAt) {
		t.Fatalf("starts_at = %v, want %v", schedule.StartsAt, versions[1].Schedule.StartsAt)
	}
}

func TestEffectiveDailyFeedScheduleUsesHistoricalVersionForRequestedDate(t *testing.T) {
	location, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatalf("time.LoadLocation returned error: %v", err)
	}
	versions := []dailyFeedScheduleVersion{
		{
			Schedule: DailyFeedSchedule{
				StartsAt:        time.Date(2026, 7, 1, 8, 0, 0, 0, location),
				Timezone:        "America/Chicago",
				IntervalSeconds: 86400,
			},
		},
		{
			Schedule: DailyFeedSchedule{
				StartsAt:        time.Date(2026, 7, 4, 15, 30, 0, 0, location),
				Timezone:        "America/Chicago",
				IntervalSeconds: 7 * 86400,
			},
		},
	}

	beforeChange := time.Date(2026, 7, 3, 0, 0, 0, 0, time.UTC)
	schedule, err := effectiveDailyFeedScheduleFromVersions(
		versions,
		DailyFeedSchedule{},
		&beforeChange,
		time.Date(2026, 7, 5, 9, 0, 0, 0, location),
	)
	if err != nil {
		t.Fatalf("effectiveDailyFeedScheduleFromVersions returned error: %v", err)
	}
	if schedule.IntervalSeconds != 86400 {
		t.Fatalf("interval before change = %d, want daily", schedule.IntervalSeconds)
	}

	changeDate := time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC)
	schedule, err = effectiveDailyFeedScheduleFromVersions(
		versions,
		DailyFeedSchedule{},
		&changeDate,
		time.Date(2026, 7, 5, 9, 0, 0, 0, location),
	)
	if err != nil {
		t.Fatalf("effectiveDailyFeedScheduleFromVersions returned error: %v", err)
	}
	if schedule.IntervalSeconds != 7*86400 {
		t.Fatalf("interval on change date = %d, want weekly", schedule.IntervalSeconds)
	}
}

func candidateIDs(candidates []dailyCatalogCandidate) []string {
	ids := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		ids = append(ids, candidate.ID)
	}
	return ids
}
