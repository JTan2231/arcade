package app

import (
	"context"
	"testing"
	"time"
)

func TestDailyFeedEventStatusUsesInclusiveEndDate(t *testing.T) {
	event := DailyFeedEvent{StartsOn: "2026-07-20", EndsOn: "2026-07-22"}
	cases := []struct {
		date string
		want string
	}{
		{date: "2026-07-19", want: dailyFeedEventStatusUpcoming},
		{date: "2026-07-20", want: dailyFeedEventStatusActive},
		{date: "2026-07-22", want: dailyFeedEventStatusActive},
		{date: "2026-07-23", want: dailyFeedEventStatusEnded},
	}
	for _, test := range cases {
		date, err := time.Parse(dailyFeedDateLayout, test.date)
		if err != nil {
			t.Fatal(err)
		}
		if got := dailyFeedEventStatus(event, date); got != test.want {
			t.Fatalf("status on %s = %q, want %q", test.date, got, test.want)
		}
	}
}

func TestNormalizeDailyFeedEventSelectionTokenReusesPreviewToken(t *testing.T) {
	const token = "0123456789abcdef0123456789abcdef"
	got, err := normalizeDailyFeedEventSelectionToken(token)
	if err != nil {
		t.Fatalf("normalize token: %v", err)
	}
	if got != token {
		t.Fatalf("token = %q, want %q", got, token)
	}
	if _, err := normalizeDailyFeedEventSelectionToken("not-a-token"); err == nil {
		t.Fatal("expected malformed selection token to be rejected")
	}
	generated, err := normalizeDailyFeedEventSelectionToken("")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	if !dailyFeedEventSelectionTokenPattern.MatchString(generated) {
		t.Fatalf("generated token = %q", generated)
	}
}

func TestActiveDailyFeedEventPatchOnlyAllowsEndDate(t *testing.T) {
	if !activeDailyFeedEventPatchAllowed(patchDailyFeedEventRequest{
		EndsOn: optionalStringField{Set: true, Value: "2026-07-30"},
	}) {
		t.Fatal("ends_on-only patch should be allowed")
	}
	if activeDailyFeedEventPatchAllowed(patchDailyFeedEventRequest{
		Name:   optionalStringField{Set: true, Value: "Renamed"},
		EndsOn: optionalStringField{Set: true, Value: "2026-07-30"},
	}) {
		t.Fatal("active patch with a name change should be rejected")
	}
	if activeDailyFeedEventPatchAllowed(patchDailyFeedEventRequest{}) {
		t.Fatal("empty active patch should be rejected")
	}
}

func TestResolveDailyFeedSelectionConfigSkipsDatabaseForPreviewAndDailyThread(t *testing.T) {
	server := &Server{}
	thread, err := server.resolveDailyFeedSelectionConfig(context.Background(), DailyFeed{
		Kind: dailyFeedKindDailyThread,
	}, time.Now())
	if err != nil {
		t.Fatalf("resolve daily thread: %v", err)
	}
	if thread.Event != nil || thread.SourceID != "" || thread.ItemCount != 0 {
		t.Fatalf("daily thread config = %#v", thread)
	}

	sourceID := "source-id"
	itemCount := 3
	preview, err := server.resolveDailyFeedSelectionConfig(context.Background(), DailyFeed{
		ID:        "preview",
		Kind:      dailyFeedKindCatalogDaily,
		SourceID:  &sourceID,
		ItemCount: &itemCount,
		Filters:   []DailyFeedRuleFilter{{FieldID: "field-id", Op: "eq", TextValues: []string{"x"}}},
	}, time.Now())
	if err != nil {
		t.Fatalf("resolve preview: %v", err)
	}
	if preview.SourceID != sourceID || preview.ItemCount != itemCount || len(preview.Filters) != 1 || preview.Event != nil {
		t.Fatalf("preview config = %#v", preview)
	}
}
