package app

import (
	"testing"
	"time"
)

func TestNormalizeCreateFeedMetricDefaultsSystemMetric(t *testing.T) {
	input, err := normalizeCreateFeedMetricRequest(createFeedMetricRequest{
		SystemKey: feedMetricKeyPostCount,
	})
	if err != nil {
		t.Fatalf("normalizeCreateFeedMetricRequest returned error: %v", err)
	}
	if input.DisplayName != "Post count" {
		t.Fatalf("display name = %q", input.DisplayName)
	}
	if input.Aggregation != metricAggregationCount {
		t.Fatalf("aggregation = %q", input.Aggregation)
	}
}

func TestNormalizeCreateFeedMetricValidatesJudgedPrompt(t *testing.T) {
	_, err := normalizeCreateFeedMetricRequest(createFeedMetricRequest{
		SystemKey:   feedMetricKeyJudged,
		DisplayName: "Quality",
		Aggregation: metricAggregationAverage,
	})
	if err == nil {
		t.Fatal("expected judged metric without prompt to fail")
	}
}

func TestNormalizeCreateFeedMetricRejectsInvalidAggregation(t *testing.T) {
	_, err := normalizeCreateFeedMetricRequest(createFeedMetricRequest{
		SystemKey:   feedMetricKeyAveragePostLengthWords,
		DisplayName: "Words",
		Aggregation: metricAggregationSum,
	})
	if err == nil {
		t.Fatal("expected invalid aggregation to fail")
	}
}

func TestScheduledFeedDatesUsesFeedCadence(t *testing.T) {
	location, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}

	dates, err := scheduledFeedDates(DailyFeedSchedule{
		StartsAt:        time.Date(2026, 6, 1, 8, 0, 0, 0, location),
		Timezone:        "America/Chicago",
		IntervalSeconds: 7 * 86400,
	}, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("scheduledFeedDates returned error: %v", err)
	}

	got := make([]string, 0, len(dates))
	for _, date := range dates {
		got = append(got, date.Format(dailyFeedDateLayout))
	}
	want := []string{"2026-06-01", "2026-06-08", "2026-06-15"}
	if len(got) != len(want) {
		t.Fatalf("dates = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("dates = %v, want %v", got, want)
		}
	}
}

func TestBuildMetricLeaderboardRowsRanksTiesAndUnrankedRows(t *testing.T) {
	metric := FeedMetric{
		SystemKey:   feedMetricKeyJudged,
		Aggregation: metricAggregationAverage,
	}
	members := []PublicUser{
		{ID: "ana", DisplayName: "Ana"},
		{ID: "ben", DisplayName: "Ben"},
		{ID: "cal", DisplayName: "Cal"},
		{ID: "dan", DisplayName: "Dan"},
	}
	at := time.Date(2026, 6, 28, 12, 0, 0, 0, time.UTC)
	rows := buildMetricLeaderboardRows(metric, members, []metricSample{
		{UserID: "ana", Value: 8, At: at},
		{UserID: "ana", Value: 10, At: at.Add(time.Minute)},
		{UserID: "ben", Value: 9, At: at},
		{UserID: "dan", Value: 7, At: at},
	})

	assertRank(t, rows[0], "ana", 1)
	assertRank(t, rows[1], "ben", 1)
	assertRank(t, rows[2], "dan", 3)
	if rows[3].User.ID != "cal" {
		t.Fatalf("last row user = %q, want cal", rows[3].User.ID)
	}
	if rows[3].Rank != nil || rows[3].RawValue != nil || rows[3].Value != "-" {
		t.Fatalf("unranked row = %+v", rows[3])
	}
}

func assertRank(t *testing.T, row MetricLeaderboardRow, userID string, rank int) {
	t.Helper()
	if row.User.ID != userID {
		t.Fatalf("user = %q, want %q", row.User.ID, userID)
	}
	if row.Rank == nil || *row.Rank != rank {
		t.Fatalf("rank for %s = %v, want %d", userID, row.Rank, rank)
	}
}
