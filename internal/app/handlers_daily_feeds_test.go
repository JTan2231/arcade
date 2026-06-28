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

	sortDailyCandidates(first, "feed", "2026-06-21")
	sortDailyCandidates(second, "feed", "2026-06-21")

	if !reflect.DeepEqual(candidateIDs(first), candidateIDs(second)) {
		t.Fatalf("same inputs produced different orders: %v vs %v", candidateIDs(first), candidateIDs(second))
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

func candidateIDs(candidates []dailyCatalogCandidate) []string {
	ids := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		ids = append(ids, candidate.ID)
	}
	return ids
}
