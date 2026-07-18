package aozoracatalog

import (
	"reflect"
	"sort"
	"testing"
)

func TestProjectItemsChoosesRepresentativeDeterministically(t *testing.T) {
	metadata := projectionTestMetadata()
	endpoint := Endpoint{RangeKind: RangeKindWord, StartSurface: "カナ", EndSurface: "ゴール"}
	exact := projectionOccurrence(2, "これはずっと長い文です。", Selector{Kind: SelectorKindExact, Start: "これはずっと長い文です。", Verified: true}, endpoint)
	contextual := projectionOccurrence(0, "短い。", Selector{Kind: SelectorKindContextualExact, Prefix: "前", Start: "短い。", Verified: true}, endpoint)
	unverified := projectionOccurrence(1, "未検証。", Selector{Kind: SelectorKindExact, Start: "未検証。", Verified: false}, endpoint)

	itemsA, err := ProjectDocument(metadata, []Occurrence{contextual, exact, unverified})
	if err != nil {
		t.Fatal(err)
	}
	itemsB, err := ProjectDocument(metadata, []Occurrence{unverified, exact, contextual})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(itemsA, itemsB) {
		t.Fatalf("projection depends on input ordering:\nA=%#v\nB=%#v", itemsA, itemsB)
	}
	if len(itemsA) != 1 {
		t.Fatalf("items = %d, want 1", len(itemsA))
	}
	item := itemsA[0]
	documentID := DocumentID(metadata.HTMLPath)
	wantOccurrenceID := OccurrenceID(documentID, IdentityText(exact.ExactText), 0)
	if item.RepresentativeOccurrenceID != wantOccurrenceID {
		t.Errorf("representative = %q, want exact selector occurrence %q", item.RepresentativeOccurrenceID, wantOccurrenceID)
	}
	if item.OccurrenceCount != 2 {
		t.Errorf("occurrence count = %d, want verified count 2", item.OccurrenceCount)
	}
	if item.StartKey != "かな" || item.EndKey != "ごーる" {
		t.Errorf("normalized keys = %q/%q", item.StartKey, item.EndKey)
	}
	if item.Name != "作品 — カナ … ゴール" {
		t.Errorf("name = %q", item.Name)
	}
	if got, want := item.AuthorNames, []string{"A Author", "Z Author"}; !reflect.DeepEqual(got, want) {
		t.Errorf("authors = %v, want %v", got, want)
	}
}

func TestRepresentativeTieBreakOrder(t *testing.T) {
	metadata := projectionTestMetadata()
	endpoint := Endpoint{RangeKind: RangeKindWord, StartSurface: "始", EndSurface: "終"}

	// Both selectors are exact, so the shorter encoded selector wins even
	// though its sentence is longer.
	shortSelector := projectionOccurrence(0, "この文の方が長い。", Selector{Kind: SelectorKindExact, Start: "x", Verified: true}, endpoint)
	longSelector := projectionOccurrence(1, "短文。", Selector{Kind: SelectorKindExact, Start: "long-selector", Verified: true}, endpoint)
	items, err := ProjectDocument(metadata, []Occurrence{longSelector, shortSelector})
	if err != nil {
		t.Fatal(err)
	}
	want := OccurrenceID(DocumentID(metadata.HTMLPath), IdentityText(shortSelector.ExactText), 0)
	if got := items[0].RepresentativeOccurrenceID; got != want {
		t.Fatalf("short-selector representative = %q, want %q", got, want)
	}

	// Equal selector lengths fall through to sentence grapheme count.
	shortSentence := projectionOccurrence(2, "短。", Selector{Kind: SelectorKindExact, Start: "aa", Verified: true}, endpoint)
	longSentence := projectionOccurrence(3, "もっと長い。", Selector{Kind: SelectorKindExact, Start: "bb", Verified: true}, endpoint)
	items, err = ProjectDocument(metadata, []Occurrence{longSentence, shortSentence})
	if err != nil {
		t.Fatal(err)
	}
	want = OccurrenceID(DocumentID(metadata.HTMLPath), IdentityText(shortSentence.ExactText), 0)
	if got := items[0].RepresentativeOccurrenceID; got != want {
		t.Fatalf("short-sentence representative = %q, want %q", got, want)
	}
}

func TestRepresentativeSelectorStrategyPreference(t *testing.T) {
	metadata := projectionTestMetadata()
	endpoint := Endpoint{RangeKind: RangeKindWord, StartSurface: "始", EndSurface: "終"}
	tests := []struct {
		name      string
		preferred Selector
		other     Selector
	}{
		{
			name:      "exact before range",
			preferred: Selector{Kind: SelectorKindExact, Start: "an intentionally long exact selector", Verified: true},
			other:     Selector{Kind: SelectorKindRange, Start: "a", End: "b", Verified: true},
		},
		{
			name:      "range before contextual exact",
			preferred: Selector{Kind: SelectorKindRange, Start: "an intentionally long range start", End: "range end", Verified: true},
			other:     Selector{Kind: SelectorKindContextualExact, Prefix: "p", Start: "x", Verified: true},
		},
		{
			name:      "contextual exact before contextual range",
			preferred: Selector{Kind: SelectorKindContextualExact, Prefix: "a long prefix", Start: "a long exact term", Verified: true},
			other:     Selector{Kind: SelectorKindContextualRange, Prefix: "p", Start: "x", End: "y", Verified: true},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			preferred := projectionOccurrence(0, "優先される文。", test.preferred, endpoint)
			other := projectionOccurrence(1, "もう一つの文。", test.other, endpoint)
			items, err := ProjectDocument(metadata, []Occurrence{other, preferred})
			if err != nil {
				t.Fatal(err)
			}
			want := OccurrenceID(DocumentID(metadata.HTMLPath), IdentityText(preferred.ExactText), 0)
			if got := items[0].RepresentativeOccurrenceID; got != want {
				t.Fatalf("representative = %q, want preferred strategy occurrence %q", got, want)
			}
		})
	}
}

func TestProjectionPreservesPreassignedDuplicateOrdinalGaps(t *testing.T) {
	metadata := projectionTestMetadata()
	endpoint := Endpoint{RangeKind: RangeKindWord, StartSurface: "始", EndSurface: "終"}
	all := []Occurrence{
		projectionOccurrence(0, "同じ文。", Selector{Kind: SelectorKindExact, Start: "rejected", Verified: false}, endpoint),
		projectionOccurrence(1, "同じ文。", Selector{Kind: SelectorKindExact, Start: "verified", Verified: true}, endpoint),
	}
	for index := range all {
		all[index].HTMLPath = metadata.HTMLPath
	}
	documentID := DocumentID(metadata.HTMLPath)
	AssignOccurrenceIdentities(documentID, all)
	if all[1].DuplicateOrdinal != 1 {
		t.Fatalf("fixture duplicate ordinal = %d, want 1", all[1].DuplicateOrdinal)
	}

	items, err := ProjectDocument(metadata, []Occurrence{all[1]})
	if err != nil {
		t.Fatal(err)
	}
	if got := items[0].RepresentativeOccurrenceID; got != all[1].OccurrenceID {
		t.Fatalf("projection renumbered filtered duplicate: got %q, want %q", got, all[1].OccurrenceID)
	}
}

func TestProjectionIdentityIgnoresRepresentativeAndSeparatesKinds(t *testing.T) {
	metadata := projectionTestMetadata()
	word := Endpoint{RangeKind: RangeKindWord, StartSurface: "始", EndSurface: "終"}
	grapheme := Endpoint{RangeKind: RangeKindGrapheme3, StartSurface: "始", EndSurface: "終"}
	first := projectionOccurrence(0, "第一の文。", Selector{Kind: SelectorKindExact, Start: "first", Verified: true}, word, grapheme)
	second := projectionOccurrence(1, "第二の文。", Selector{Kind: SelectorKindExact, Start: "second", Verified: true}, word, grapheme)

	firstItems, err := ProjectDocument(metadata, []Occurrence{first})
	if err != nil {
		t.Fatal(err)
	}
	secondItems, err := ProjectDocument(metadata, []Occurrence{second})
	if err != nil {
		t.Fatal(err)
	}
	if len(firstItems) != 2 || len(secondItems) != 2 {
		t.Fatalf("projected lengths = %d/%d", len(firstItems), len(secondItems))
	}
	firstIDs := map[RangeKind]string{}
	secondIDs := map[RangeKind]string{}
	for _, item := range firstItems {
		firstIDs[item.RangeKind] = item.ExternalID
	}
	for _, item := range secondItems {
		secondIDs[item.RangeKind] = item.ExternalID
	}
	if !reflect.DeepEqual(firstIDs, secondIDs) {
		t.Fatalf("representative changed IDs: %v vs %v", firstIDs, secondIDs)
	}
	if firstIDs[RangeKindWord] == firstIDs[RangeKindGrapheme3] {
		t.Fatal("word and grapheme3 projected IDs are equal")
	}
}

func TestProjectItemsSortsByExternalID(t *testing.T) {
	metadataA := projectionTestMetadata()
	metadataB := metadataA
	metadataB.HTMLPath = "cards/000002/files/b.html"
	metadataByPath := map[string]DocumentMetadata{metadataA.HTMLPath: metadataA, metadataB.HTMLPath: metadataB}
	endpointA := Endpoint{RangeKind: RangeKindWord, StartSurface: "甲", EndSurface: "乙"}
	endpointB := Endpoint{RangeKind: RangeKindWord, StartSurface: "丙", EndSurface: "丁"}
	occurrenceA := projectionOccurrence(0, "甲乙。", Selector{Kind: SelectorKindExact, Start: "甲乙。", Verified: true}, endpointA)
	occurrenceA.HTMLPath = metadataA.HTMLPath
	occurrenceB := projectionOccurrence(0, "丙丁。", Selector{Kind: SelectorKindExact, Start: "丙丁。", Verified: true}, endpointB)
	occurrenceB.HTMLPath = metadataB.HTMLPath
	items, err := ProjectItems(metadataByPath, []Occurrence{occurrenceB, occurrenceA})
	if err != nil {
		t.Fatal(err)
	}
	if !sort.SliceIsSorted(items, func(i, j int) bool { return items[i].ExternalID < items[j].ExternalID }) {
		t.Fatalf("items are not sorted: %#v", items)
	}
}

func TestGraphemeCount(t *testing.T) {
	tests := map[string]int{
		"":        0,
		"日本語。":    4,
		"か\u3099": 1,
		"\r\n":    1,
		"🇯🇵🇺🇸":    2,
		"👩‍👩‍👧‍👦": 1,
		"각":     1,
	}
	for value, want := range tests {
		if got := GraphemeCount(value); got != want {
			t.Errorf("GraphemeCount(%q) = %d, want %d", value, got, want)
		}
	}
}

func TestProjectItemsRejectsInconsistentNormalizedKey(t *testing.T) {
	metadata := projectionTestMetadata()
	endpoint := Endpoint{RangeKind: RangeKindWord, StartSurface: "カナ", EndSurface: "終", StartKey: "カナ"}
	occurrence := projectionOccurrence(0, "文。", Selector{Kind: SelectorKindExact, Start: "文。", Verified: true}, endpoint)
	if _, err := ProjectDocument(metadata, []Occurrence{occurrence}); err == nil {
		t.Fatal("inconsistent endpoint key accepted")
	}
}

func projectionTestMetadata() DocumentMetadata {
	return DocumentMetadata{
		HTMLPath:    "cards/000001/files/a.html",
		WorkID:      "00042",
		WorkName:    "作品",
		AuthorNames: []string{"Z Author", "A Author", "Z Author", ""},
	}
}

func projectionOccurrence(index int, exactText string, selector Selector, endpoints ...Endpoint) Occurrence {
	return Occurrence{
		Index:             index,
		ExactText:         exactText,
		SentenceGraphemes: GraphemeCount(exactText),
		Selector:          selector,
		Endpoints:         endpoints,
	}
}
