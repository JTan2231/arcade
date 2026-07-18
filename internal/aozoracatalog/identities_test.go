package aozoracatalog

import (
	"crypto/sha256"
	"encoding/hex"
	"reflect"
	"testing"
)

func TestKanaSoundKey(t *testing.T) {
	tests := map[string]string{
		"カタカナ":     "かたかな",
		"ガッツポーズ":   "がっつぽーず",
		"ヽヾ":       "ゝゞ",
		"ｶﾞｯｺｳ":    "がっこう",
		"ひらがな":     "ひらがな",
		"ＡＢＣ café": "ABC café",
		"ヷ":        "わ゙",
	}
	for input, want := range tests {
		if got := KanaSoundKey(input); got != want {
			t.Errorf("KanaSoundKey(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestIdentityTextCollapsesWhitespaceAndNormalizesNFC(t *testing.T) {
	input := " \tその\u00a0\n朝 e\u0301。\r\n "
	if got, want := IdentityText(input), "その 朝 é。"; got != want {
		t.Fatalf("IdentityText() = %q, want %q", got, want)
	}
	if got := IdentityText("\t\n\u3000"); got != "" {
		t.Fatalf("whitespace-only identity = %q", got)
	}
}

func TestDuplicateOrdinalsAndAssignmentUseDocumentOrder(t *testing.T) {
	if got, want := DuplicateOrdinals([]string{"同じ。", "別。", "同じ。", "同じ。"}), []int{0, 0, 1, 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("DuplicateOrdinals() = %v, want %v", got, want)
	}

	documentID := DocumentID("cards/000001/files/a.html")
	occurrences := []Occurrence{
		{Index: 2, ExactText: " 同じ。 "},
		{Index: 0, ExactText: "同じ。"},
		{Index: 1, ExactText: "別。"},
	}
	AssignOccurrenceIdentities(documentID, occurrences)
	if got := []int{occurrences[0].DuplicateOrdinal, occurrences[1].DuplicateOrdinal, occurrences[2].DuplicateOrdinal}; !reflect.DeepEqual(got, []int{1, 0, 0}) {
		t.Fatalf("assigned ordinals = %v", got)
	}
	for _, occurrence := range occurrences {
		want := OccurrenceID(documentID, occurrence.IdentityText, occurrence.DuplicateOrdinal)
		if occurrence.DocumentID != documentID || occurrence.OccurrenceID != want {
			t.Errorf("assigned identity = %#v, want occurrence ID %q", occurrence, want)
		}
	}
}

func TestFinalizeOccurrenceIdentitiesPreservesWorkerOrdinalGap(t *testing.T) {
	documentID := DocumentID("cards/000001/files/a.html")
	occurrences := []Occurrence{{
		Index:            4,
		ExactText:        "同じ文。",
		IdentityText:     "同じ文。",
		DuplicateOrdinal: 2,
	}}
	if err := FinalizeOccurrenceIdentities(documentID, occurrences); err != nil {
		t.Fatal(err)
	}
	want := OccurrenceID(documentID, "同じ文。", 2)
	if occurrences[0].OccurrenceID != want || occurrences[0].DuplicateOrdinal != 2 {
		t.Fatalf("finalized occurrence = %#v, want ordinal 2 and ID %q", occurrences[0], want)
	}

	bad := append([]Occurrence(nil), occurrences...)
	bad[0].IdentityText = "違う文。"
	if err := FinalizeOccurrenceIdentities(documentID, bad); err == nil {
		t.Fatal("inconsistent worker identity text accepted")
	}
}

func TestIdentityHashContractsAndSelectorIndependence(t *testing.T) {
	htmlPath := "cards/000008/files/47386_69118.html"
	wantDocumentID := sha256HexForTest("aozora-document-v2\x00" + htmlPath)
	if got := DocumentID(htmlPath); got != wantDocumentID {
		t.Fatalf("DocumentID() = %q, want %q", got, wantDocumentID)
	}

	identity := "その朝 帰った。"
	wantOccurrenceID := sha256HexForTest("aozora-occurrence-v2\x00" + wantDocumentID + "\x00" + identity + "\x000")
	if got := OccurrenceID(wantDocumentID, identity, 0); got != wantOccurrenceID {
		t.Fatalf("OccurrenceID() = %q, want %q", got, wantOccurrenceID)
	}

	first := Occurrence{Index: 0, ExactText: identity, Selector: Selector{Start: "old selector"}}
	second := first
	second.Selector.Start = "repaired selector"
	firstSet := []Occurrence{first}
	secondSet := []Occurrence{second}
	AssignOccurrenceIdentities(wantDocumentID, firstSet)
	AssignOccurrenceIdentities(wantDocumentID, secondSet)
	if firstSet[0].OccurrenceID != secondSet[0].OccurrenceID {
		t.Fatal("selector repair changed occurrence identity")
	}

	wordID := PairDocumentExternalID(wantDocumentID, RangeKindWord, "その朝", "帰った")
	wantWordID := "pair-document-v2:" + sha256HexForTest("aozora-pair-document-v2\x00"+wantDocumentID+"\x00word\x00その朝\x00帰った")
	if wordID != wantWordID {
		t.Fatalf("PairDocumentExternalID() = %q, want %q", wordID, wantWordID)
	}
	if graphemeID := PairDocumentExternalID(wantDocumentID, RangeKindGrapheme3, "その朝", "帰った"); graphemeID == wordID {
		t.Fatal("word and grapheme3 identities are equal")
	}
}

func sha256HexForTest(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}
