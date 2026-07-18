package aozoracatalog

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"
)

const upperHex = "0123456789ABCDEF"

// SerializeSelector encodes each literal selector term independently and then
// inserts only the punctuation belonging to the Text Fragment grammar.
func SerializeSelector(selector Selector) (string, error) {
	if err := ValidateRawSelector(selector); err != nil {
		return "", err
	}
	encoded := serializeSelectorTerms(selector)
	if selector.Encoded != "" && selector.Encoded != encoded {
		return "", errors.New("selector encoded value does not match its raw terms")
	}
	return encoded, nil
}

// SerializeTextSelector is a terminology-compatible alias.
func SerializeTextSelector(selector Selector) (string, error) {
	return SerializeSelector(selector)
}

// ValidateRawSelector checks the literal selector model without relying on a
// browser match. Verification is a separate eligibility requirement.
func ValidateRawSelector(selector Selector) error {
	if selector.Start == "" {
		return errors.New("selector start is required")
	}
	terms := [...]struct {
		name string
		text string
	}{
		{name: "prefix", text: selector.Prefix},
		{name: "start", text: selector.Start},
		{name: "end", text: selector.End},
		{name: "suffix", text: selector.Suffix},
	}
	for _, term := range terms {
		if !utf8.ValidString(term.text) {
			return fmt.Errorf("selector %s is not valid UTF-8", term.name)
		}
	}

	expectedKind := inferSelectorKind(selector)
	switch selector.Kind {
	case "", expectedKind:
		return nil
	case SelectorKindExact, SelectorKindRange, SelectorKindContextualExact, SelectorKindContextualRange:
		return fmt.Errorf("selector kind %q does not match its terms (want %q)", selector.Kind, expectedKind)
	default:
		return fmt.Errorf("unknown selector kind %q", selector.Kind)
	}
}

// ParseSelector parses only the canonical stored value after "text=". Raw
// punctuation in terms, lowercase escapes, and malformed UTF-8 are rejected.
// A decoded literal such as "%20" is valid source text; build-time comparison
// with the worker's raw terms is what detects accidental double encoding.
func ParseSelector(encoded string) (Selector, error) {
	if encoded == "" {
		return Selector{}, errors.New("text selector is empty")
	}
	if !isASCII(encoded) {
		return Selector{}, errors.New("text selector must contain only encoded ASCII")
	}

	parts := strings.Split(encoded, ",")
	if len(parts) > 4 {
		return Selector{}, errors.New("text selector has too many structural terms")
	}
	selector := Selector{Encoded: encoded}

	if len(parts) >= 2 && strings.HasSuffix(parts[0], "-") {
		prefix := strings.TrimSuffix(parts[0], "-")
		if prefix == "" {
			return Selector{}, errors.New("text selector has an empty prefix")
		}
		decoded, err := decodeSelectorTerm("prefix", prefix)
		if err != nil {
			return Selector{}, err
		}
		selector.Prefix = decoded
		parts = parts[1:]
	}
	if len(parts) >= 2 && strings.HasPrefix(parts[len(parts)-1], "-") {
		suffix := strings.TrimPrefix(parts[len(parts)-1], "-")
		if suffix == "" {
			return Selector{}, errors.New("text selector has an empty suffix")
		}
		decoded, err := decodeSelectorTerm("suffix", suffix)
		if err != nil {
			return Selector{}, err
		}
		selector.Suffix = decoded
		parts = parts[:len(parts)-1]
	}
	if len(parts) < 1 || len(parts) > 2 {
		return Selector{}, errors.New("text selector has an invalid term structure")
	}

	start, err := decodeSelectorTerm("start", parts[0])
	if err != nil {
		return Selector{}, err
	}
	selector.Start = start
	if len(parts) == 2 {
		end, err := decodeSelectorTerm("end", parts[1])
		if err != nil {
			return Selector{}, err
		}
		selector.End = end
	}
	selector.Kind = inferSelectorKind(selector)

	canonical := serializeSelectorTerms(selector)
	if canonical != encoded {
		return Selector{}, fmt.Errorf("text selector is not canonical (want %q)", canonical)
	}
	return selector, nil
}

// ParseTextSelector is a terminology-compatible alias.
func ParseTextSelector(encoded string) (Selector, error) {
	return ParseSelector(encoded)
}

func ValidateSelector(encoded string) error {
	_, err := ParseSelector(encoded)
	return err
}

// ValidateTextSelector is a terminology-compatible alias.
func ValidateTextSelector(encoded string) error {
	return ValidateSelector(encoded)
}

func inferSelectorKind(selector Selector) SelectorKind {
	contextual := selector.Prefix != "" || selector.Suffix != ""
	if selector.End != "" {
		if contextual {
			return SelectorKindContextualRange
		}
		return SelectorKindRange
	}
	if contextual {
		return SelectorKindContextualExact
	}
	return SelectorKindExact
}

func serializeSelectorTerms(selector Selector) string {
	var result strings.Builder
	// Percent encoding can make each input byte three output bytes. This is an
	// upper bound that avoids repeated growth for Japanese selector terms.
	result.Grow(3 * (len(selector.Prefix) + len(selector.Start) + len(selector.End) + len(selector.Suffix)))
	if selector.Prefix != "" {
		result.WriteString(encodeSelectorTerm(selector.Prefix))
		result.WriteString("-,")
	}
	result.WriteString(encodeSelectorTerm(selector.Start))
	if selector.End != "" {
		result.WriteByte(',')
		result.WriteString(encodeSelectorTerm(selector.End))
	}
	if selector.Suffix != "" {
		result.WriteString(",-")
		result.WriteString(encodeSelectorTerm(selector.Suffix))
	}
	return result.String()
}

// encodeSelectorTerm follows encodeURIComponent's unescaped ASCII set except
// that '-' is always encoded because it is Text Fragment grammar punctuation.
func encodeSelectorTerm(term string) string {
	var result strings.Builder
	result.Grow(len(term))
	for i := 0; i < len(term); i++ {
		value := term[i]
		if selectorTermByteUnescaped(value) {
			result.WriteByte(value)
			continue
		}
		result.WriteByte('%')
		result.WriteByte(upperHex[value>>4])
		result.WriteByte(upperHex[value&0x0f])
	}
	return result.String()
}

func selectorTermByteUnescaped(value byte) bool {
	return value >= 'a' && value <= 'z' ||
		value >= 'A' && value <= 'Z' ||
		value >= '0' && value <= '9' ||
		strings.ContainsRune("_.!~*'()", rune(value))
}

func decodeSelectorTerm(name, term string) (string, error) {
	if term == "" {
		return "", fmt.Errorf("text selector has an empty %s", name)
	}
	decoded, err := url.PathUnescape(term)
	if err != nil {
		return "", fmt.Errorf("decode selector %s: %w", name, err)
	}
	if decoded == "" {
		return "", fmt.Errorf("text selector has an empty %s", name)
	}
	if !utf8.ValidString(decoded) {
		return "", fmt.Errorf("selector %s does not decode to valid UTF-8", name)
	}
	return decoded, nil
}

func isASCII(value string) bool {
	for i := range len(value) {
		if value[i] >= utf8.RuneSelf {
			return false
		}
	}
	return true
}
