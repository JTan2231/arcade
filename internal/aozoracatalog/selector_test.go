package aozoracatalog

import (
	"reflect"
	"strings"
	"testing"
)

func TestSerializeSelectorCanonicalContextualRange(t *testing.T) {
	selector := Selector{
		Kind:   SelectorKindContextualRange,
		Prefix: "前夜",
		Start:  "その朝",
		End:    "帰った。",
		Suffix: "次の日",
	}
	want := "%E5%89%8D%E5%A4%9C-,%E3%81%9D%E3%81%AE%E6%9C%9D,%E5%B8%B0%E3%81%A3%E3%81%9F%E3%80%82,-%E6%AC%A1%E3%81%AE%E6%97%A5"
	got, err := SerializeSelector(selector)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("SerializeSelector() = %q, want %q", got, want)
	}
	parsed, err := ParseSelector(got)
	if err != nil {
		t.Fatal(err)
	}
	selector.Encoded = got
	if !reflect.DeepEqual(parsed, selector) {
		t.Fatalf("ParseSelector() = %#v, want %#v", parsed, selector)
	}
}

func TestSelectorRoundTripsEveryStructuralForm(t *testing.T) {
	tests := []Selector{
		{Kind: SelectorKindExact, Start: "文。"},
		{Kind: SelectorKindRange, Start: "始め", End: "終り。"},
		{Kind: SelectorKindContextualExact, Prefix: "前", Start: "文。"},
		{Kind: SelectorKindContextualExact, Start: "文。", Suffix: "後"},
		{Kind: SelectorKindContextualExact, Prefix: "前", Start: "文。", Suffix: "後"},
		{Kind: SelectorKindContextualRange, Prefix: "前", Start: "始", End: "終", Suffix: "後"},
	}
	for _, selector := range tests {
		encoded, err := SerializeSelector(selector)
		if err != nil {
			t.Fatalf("SerializeSelector(%#v): %v", selector, err)
		}
		parsed, err := ParseSelector(encoded)
		if err != nil {
			t.Fatalf("ParseSelector(%q): %v", encoded, err)
		}
		selector.Encoded = encoded
		if !reflect.DeepEqual(parsed, selector) {
			t.Errorf("round trip = %#v, want %#v", parsed, selector)
		}
	}
}

func TestSerializeSelectorEncodesLiteralGrammarAndUTF8(t *testing.T) {
	selector := Selector{Kind: SelectorKindExact, Start: "a-b,c&d% e日本"}
	encoded, err := SerializeSelector(selector)
	if err != nil {
		t.Fatal(err)
	}
	want := "a%2Db%2Cc%26d%25%20e%E6%97%A5%E6%9C%AC"
	if encoded != want {
		t.Fatalf("encoded = %q, want %q", encoded, want)
	}
	parsed, err := ParseSelector(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Start != selector.Start {
		t.Fatalf("decoded start = %q", parsed.Start)
	}
}

func TestSelectorValidationRejectsNoncanonicalEncoding(t *testing.T) {
	tests := map[string]string{
		"":                        "empty",
		"raw-hyphen":              "raw term punctuation",
		"%e6%96%87":               "lowercase escapes",
		"%E6%96":                  "malformed UTF-8",
		"prefix-,,start":          "empty structural term",
		"prefix-,start,end,extra": "extra structural term",
	}
	for encoded, description := range tests {
		if err := ValidateSelector(encoded); err == nil {
			t.Errorf("ValidateSelector(%q) accepted %s", encoded, description)
		}
	}

	if err := ValidateSelector("100%25"); err != nil {
		t.Fatalf("literal percent rejected: %v", err)
	}
	literalEscape, err := SerializeSelector(Selector{Kind: SelectorKindExact, Start: "100%20"})
	if err != nil {
		t.Fatalf("serialize literal percent escape: %v", err)
	}
	if literalEscape != "100%2520" {
		t.Fatalf("literal percent escape = %q, want 100%%2520", literalEscape)
	}
	parsed, err := ParseSelector(literalEscape)
	if err != nil || parsed.Start != "100%20" {
		t.Fatalf("parse literal percent escape = %#v, %v", parsed, err)
	}
	if err := ValidateSelector("a%2Db%2Cc%26d"); err != nil {
		t.Fatalf("encoded literal punctuation rejected: %v", err)
	}
}

func TestSerializeSelectorValidatesKindAndEncodedValue(t *testing.T) {
	if _, err := SerializeSelector(Selector{Kind: SelectorKindRange, Start: "only one term"}); err == nil {
		t.Fatal("kind/term mismatch accepted")
	}
	if _, err := SerializeSelector(Selector{Kind: SelectorKindExact, Start: "x", Encoded: "y"}); err == nil {
		t.Fatal("mismatched worker encoding accepted")
	}
	if _, err := SerializeSelector(Selector{Start: "x"}); err != nil {
		t.Fatalf("inferred selector kind rejected: %v", err)
	}
	if _, err := SerializeSelector(Selector{Kind: SelectorKindExact, Start: strings.ToValidUTF8("\xff", "") + "\xff"}); err == nil {
		t.Fatal("invalid UTF-8 accepted")
	}
}
