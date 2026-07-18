package aozoracatalog

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

type BrowserExtractorOptions struct {
	ScriptPath string
	NodeBinary string
	Stderr     io.Writer
}

type browserExtractor struct {
	command *exec.Cmd
	stdin   io.WriteCloser
	stdout  io.ReadCloser
	encoder *json.Encoder
	decoder *json.Decoder
	stderr  *tailWriter

	mu      sync.Mutex
	nextID  int
	closed  bool
	waitErr error
}

type workerRequest struct {
	ID           int    `json:"id"`
	Op           string `json:"op"`
	SourceRoot   string `json:"source_root,omitempty"`
	HTMLPath     string `json:"html_path,omitempty"`
	Encoding     string `json:"encoding,omitempty"`
	NativeSample bool   `json:"native_sample,omitempty"`
}

type workerResponse struct {
	ID     int             `json:"id"`
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result"`
	Error  *workerError    `json:"error"`
}

type workerError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func NewBrowserExtractor(ctx context.Context, options BrowserExtractorOptions) (Extractor, error) {
	scriptPath, err := resolveWorkerScript(options.ScriptPath)
	if err != nil {
		return nil, err
	}
	node := strings.TrimSpace(options.NodeBinary)
	if node == "" {
		node = "node"
	}
	node, err = exec.LookPath(node)
	if err != nil {
		return nil, fmt.Errorf("find Node.js for Aozora browser worker: %w", err)
	}

	command := exec.CommandContext(ctx, node, scriptPath)
	command.Dir = filepath.Dir(scriptPath)
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	stderrTail := &tailWriter{limit: 16 << 10}
	if options.Stderr == nil {
		command.Stderr = stderrTail
	} else {
		command.Stderr = io.MultiWriter(options.Stderr, stderrTail)
	}
	if err := command.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, fmt.Errorf("start Aozora browser worker: %w", err)
	}

	return &browserExtractor{
		command: command,
		stdin:   stdin,
		stdout:  stdout,
		encoder: json.NewEncoder(stdin),
		decoder: json.NewDecoder(stdout),
		stderr:  stderrTail,
	}, nil
}

func (extractor *browserExtractor) Extract(ctx context.Context, request ExtractRequest) (ExtractResult, error) {
	var wire struct {
		HTMLPath          string       `json:"html_path"`
		HasText           bool         `json:"has_text"`
		RejectedReason    string       `json:"rejected_reason"`
		WorkName          string       `json:"work_name"`
		AuthorNames       []string     `json:"author_names"`
		Occurrences       []Occurrence `json:"occurrences"`
		OccurrencesSeen   int          `json:"occurrences_seen"`
		SelectorsVerified int          `json:"selectors_verified"`
		SelectorsRejected int          `json:"selectors_rejected"`
	}
	err := extractor.call(ctx, workerRequest{
		Op:           "extract",
		SourceRoot:   request.SourceRoot,
		HTMLPath:     request.HTMLPath,
		Encoding:     request.Encoding,
		NativeSample: request.NativeSample,
	}, &wire)
	if err != nil {
		var requestError *WorkerRequestError
		if errors.As(err, &requestError) && requestError.Code == "invalid_main_text" {
			return ExtractResult{RejectedReason: requestError.Message}, nil
		}
		return ExtractResult{}, err
	}
	if wire.HTMLPath != request.HTMLPath {
		return ExtractResult{}, fmt.Errorf("browser worker returned html_path %q for %q", wire.HTMLPath, request.HTMLPath)
	}
	return ExtractResult{
		HasText:           wire.HasText,
		RejectedReason:    wire.RejectedReason,
		Metadata:          HTMLMetadata{WorkName: wire.WorkName, AuthorNames: wire.AuthorNames},
		Occurrences:       wire.Occurrences,
		OccurrencesSeen:   wire.OccurrencesSeen,
		SelectorsVerified: wire.SelectorsVerified,
		SelectorsRejected: wire.SelectorsRejected,
	}, nil
}

func (extractor *browserExtractor) Stats(ctx context.Context) (ExtractorStats, error) {
	var wire struct {
		SelectorEngineRevision string `json:"selector_engine_revision"`
		ChromiumVersion        string `json:"chromium_version"`
		SelectorsVerified      int    `json:"selectors_verified"`
		NativeSamplesAttempted int    `json:"native_samples_attempted"`
		NativeSamplesInView    int    `json:"native_samples_in_view"`
	}
	if err := extractor.call(ctx, workerRequest{Op: "stats"}, &wire); err != nil {
		return ExtractorStats{}, err
	}
	return ExtractorStats{
		SelectorEngineRevision:    wire.SelectorEngineRevision,
		ChromiumVersion:           wire.ChromiumVersion,
		DOMRoundTripsVerified:     wire.SelectorsVerified,
		NativeNavigationsChecked:  wire.NativeSamplesAttempted,
		NativeNavigationsVerified: wire.NativeSamplesInView,
	}, nil
}

func (extractor *browserExtractor) call(ctx context.Context, request workerRequest, result any) error {
	extractor.mu.Lock()
	defer extractor.mu.Unlock()
	if extractor.closed {
		return errors.New("Aozora browser worker is closed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	extractor.nextID++
	request.ID = extractor.nextID
	if err := extractor.encoder.Encode(request); err != nil {
		return extractor.processError("write request", err)
	}

	var response workerResponse
	if err := extractor.decoder.Decode(&response); err != nil {
		return extractor.processError("read response", err)
	}
	if response.ID != request.ID {
		return extractor.processError("read response", fmt.Errorf("response ID %d does not match request ID %d", response.ID, request.ID))
	}
	if !response.OK {
		if response.Error == nil {
			return extractor.processError("worker request", errors.New("worker returned an unspecified error"))
		}
		return &WorkerRequestError{Code: response.Error.Code, Message: response.Error.Message}
	}
	if len(response.Result) == 0 || string(response.Result) == "null" {
		return extractor.processError("read response", errors.New("worker response has no result"))
	}
	if err := json.Unmarshal(response.Result, result); err != nil {
		return extractor.processError("decode response", err)
	}
	return nil
}

type WorkerRequestError struct {
	Code    string
	Message string
}

func (err *WorkerRequestError) Error() string {
	return fmt.Sprintf("browser worker %s: %s", err.Code, err.Message)
}

func (extractor *browserExtractor) Close() error {
	extractor.mu.Lock()
	defer extractor.mu.Unlock()
	if extractor.closed {
		return extractor.waitErr
	}
	extractor.closed = true
	extractor.nextID++
	request := workerRequest{ID: extractor.nextID, Op: "shutdown"}
	encodeErr := extractor.encoder.Encode(request)
	var response workerResponse
	decodeErr := error(nil)
	if encodeErr == nil {
		decodeErr = extractor.decoder.Decode(&response)
	}
	_ = extractor.stdin.Close()
	extractor.waitErr = extractor.command.Wait()
	_ = extractor.stdout.Close()

	if encodeErr != nil {
		return extractor.processErrorLocked("stop worker", encodeErr)
	}
	if decodeErr != nil {
		return extractor.processErrorLocked("stop worker", decodeErr)
	}
	if response.ID != request.ID || !response.OK {
		return extractor.processErrorLocked("stop worker", errors.New("worker did not acknowledge shutdown"))
	}
	if extractor.waitErr != nil {
		return extractor.processErrorLocked("wait for worker", extractor.waitErr)
	}
	return nil
}

func (extractor *browserExtractor) processError(operation string, err error) error {
	return extractor.processErrorLocked(operation, err)
}

func (extractor *browserExtractor) processErrorLocked(operation string, err error) error {
	diagnostics := strings.TrimSpace(extractor.stderr.String())
	if diagnostics == "" {
		return fmt.Errorf("%s: %w", operation, err)
	}
	return fmt.Errorf("%s: %w (worker diagnostics: %s)", operation, err, diagnostics)
}

func resolveWorkerScript(configured string) (string, error) {
	if configured = strings.TrimSpace(configured); configured != "" {
		return regularAbsoluteFile(configured)
	}
	candidates := []string{filepath.Join("tools", "aozora-dom-extract", "extract.mjs")}
	if _, currentFile, _, ok := runtime.Caller(0); ok {
		candidates = append(candidates, filepath.Join(filepath.Dir(currentFile), "..", "..", "tools", "aozora-dom-extract", "extract.mjs"))
	}
	for _, candidate := range candidates {
		resolved, err := regularAbsoluteFile(candidate)
		if err == nil {
			return resolved, nil
		}
	}
	return "", errors.New("locate tools/aozora-dom-extract/extract.mjs; run from the Arcade checkout or configure BuildOptions.WorkerScript")
}

func regularAbsoluteFile(value string) (string, error) {
	abs, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%q is not a regular file", value)
	}
	return filepath.Clean(abs), nil
}

type tailWriter struct {
	mu    sync.Mutex
	limit int
	data  []byte
}

func (writer *tailWriter) Write(data []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	written := len(data)
	if len(data) >= writer.limit {
		writer.data = append(writer.data[:0], data[len(data)-writer.limit:]...)
		return written, nil
	}
	if excess := len(writer.data) + len(data) - writer.limit; excess > 0 {
		copy(writer.data, writer.data[excess:])
		writer.data = writer.data[:len(writer.data)-excess]
	}
	writer.data = append(writer.data, data...)
	return written, nil
}

func (writer *tailWriter) String() string {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	return string(bytes.Clone(writer.data))
}
