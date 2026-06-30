package app

import (
	"net/url"
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

func TestFeedLifetimeMetricLeaderboardRangeUsesFeedCreatedDate(t *testing.T) {
	from, to, err := feedLifetimeMetricLeaderboardRange(DailyFeed{
		CreatedAt: time.Date(2026, 6, 2, 3, 30, 0, 0, time.UTC),
		Schedule: DailyFeedSchedule{
			Timezone: "America/Chicago",
		},
	}, time.Date(2026, 6, 29, 16, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("feedLifetimeMetricLeaderboardRange returned error: %v", err)
	}

	if got := from.Format(dailyFeedDateLayout); got != "2026-06-01" {
		t.Fatalf("from = %q, want 2026-06-01", got)
	}
	if got := to.Format(dailyFeedDateLayout); got != "2026-06-29" {
		t.Fatalf("to = %q, want 2026-06-29", got)
	}
}

func TestMetricLeaderboardRangeHonorsExplicitQuery(t *testing.T) {
	from, to, err := metricLeaderboardRange(DailyFeed{
		CreatedAt: time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
		Schedule: DailyFeedSchedule{
			Timezone: "UTC",
		},
	}, url.Values{
		"from": []string{"2026-06-29"},
		"to":   []string{"2026-06-29"},
	}, time.Date(2026, 6, 30, 3, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("metricLeaderboardRange returned error: %v", err)
	}

	if got := from.Format(dailyFeedDateLayout); got != "2026-06-29" {
		t.Fatalf("from = %q, want 2026-06-29", got)
	}
	if got := to.Format(dailyFeedDateLayout); got != "2026-06-29" {
		t.Fatalf("to = %q, want 2026-06-29", got)
	}
}

func TestMetricLeaderboardRangeRejectsPartialExplicitQuery(t *testing.T) {
	_, _, err := metricLeaderboardRange(DailyFeed{}, url.Values{
		"from": []string{"2026-06-29"},
	}, time.Date(2026, 6, 30, 3, 0, 0, 0, time.UTC))
	if err == nil {
		t.Fatal("expected partial explicit range to fail")
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

func TestBuildMetricLeaderboardRowsCountsZeroPostMembers(t *testing.T) {
	metric := FeedMetric{
		SystemKey:   feedMetricKeyPostCount,
		Aggregation: metricAggregationCount,
	}
	members := []PublicUser{
		{ID: "ana", DisplayName: "Ana"},
		{ID: "ben", DisplayName: "Ben"},
	}
	at := time.Date(2026, 6, 28, 12, 0, 0, 0, time.UTC)
	rows := buildMetricLeaderboardRows(metric, members, []metricSample{
		{UserID: "ana", Value: 1, At: at},
		{UserID: "ana", Value: 1, At: at.Add(time.Minute)},
	})

	assertRank(t, rows[0], "ana", 1)
	if rows[0].Value != 2 || rows[0].RawValue == nil || *rows[0].RawValue != 2 || rows[0].SampleCount != 2 {
		t.Fatalf("posted row = %+v, want value/raw/sample count 2/2/2", rows[0])
	}

	assertRank(t, rows[1], "ben", 2)
	if rows[1].Value != 0 || rows[1].RawValue == nil || *rows[1].RawValue != 0 || rows[1].SampleCount != 0 {
		t.Fatalf("zero-post row = %+v, want value/raw/sample count 0/0/0", rows[1])
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
