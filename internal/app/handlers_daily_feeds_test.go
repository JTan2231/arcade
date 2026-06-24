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
		"Watermelon",
		map[string]any{
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
		"Practice {title}. Focus on {focus}. Drill: {drill}.",
		"Jin Kazama",
		map[string]any{"focus": "electric execution"},
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
	block := DailyFeedRuleBlock{
		Filters: DailyFeedFilters{
			Rating: &DailyFeedRatingFilter{
				Min: intPtr(800),
				Max: intPtr(1200),
			},
			Tags: &DailyFeedTagFilter{
				IncludeAny: []string{"implementation"},
				ExcludeAny: []string{"geometry"},
			},
		},
	}

	if !dailyCandidateMatchesBlock(candidate, block) {
		t.Fatal("candidate should match rating and tag filters")
	}

	block.Filters.Tags.ExcludeAny = []string{"math"}
	if dailyCandidateMatchesBlock(candidate, block) {
		t.Fatal("candidate should not match excluded tag")
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

	sortDailyCandidates(first, "feed", "2026-06-21", 0, intPtr(1000))
	sortDailyCandidates(second, "feed", "2026-06-21", 0, intPtr(1000))

	if !reflect.DeepEqual(candidateIDs(first), candidateIDs(second)) {
		t.Fatalf("same inputs produced different orders: %v vs %v", candidateIDs(first), candidateIDs(second))
	}
}

func TestDailyFeedDefaults(t *testing.T) {
	if got := dailyFeedRole(0, 1, nil); got != "target" {
		t.Fatalf("single item role = %q", got)
	}
	if got := dailyFeedRole(3, 4, nil); got != "bonus" {
		t.Fatalf("fourth item role = %q", got)
	}
	if got := dailyFeedPoints(0, nil); got != 1 {
		t.Fatalf("default points = %d", got)
	}
	if got := dailyFeedPoints(1, []int{2, 3}); got != 3 {
		t.Fatalf("configured points = %d", got)
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

func TestDailyThreadRulesAreEmpty(t *testing.T) {
	server := &Server{}
	rules, err := server.normalizeDailyFeedRulesForKind(context.Background(), "group", dailyFeedKindDailyThread, DailyFeedRules{})
	if err != nil {
		t.Fatalf("normalizeDailyFeedRulesForKind returned error: %v", err)
	}
	if len(rules.Blocks) != 0 {
		t.Fatalf("rules blocks = %d", len(rules.Blocks))
	}

	_, err = server.normalizeDailyFeedRulesForKind(context.Background(), "group", dailyFeedKindDailyThread, DailyFeedRules{
		Blocks: []DailyFeedRuleBlock{{SourceID: "source", Count: 1}},
	})
	if err == nil {
		t.Fatal("expected daily thread rules to reject blocks")
	}
}

func TestDailyThreadOutputHasNoGeneratedItems(t *testing.T) {
	server := &Server{}
	requestedDate := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	output, err := server.generateDailyFeedOutputForFeed(context.Background(), DailyFeed{
		ID:       "feed-id",
		GroupID:  "group-id",
		Name:     defaultDailyThreadFeedName,
		Slug:     defaultDailyThreadFeedSlug,
		Kind:     dailyFeedKindDailyThread,
		Schedule: DailyFeedSchedule{Cadence: "daily", Timezone: "UTC"},
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

func candidateIDs(candidates []dailyCatalogCandidate) []string {
	ids := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		ids = append(ids, candidate.ID)
	}
	return ids
}

func intPtr(value int) *int {
	return &value
}
