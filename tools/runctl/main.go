package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultStartTimeout = 60 * time.Second
	defaultHTTPTimeout  = 750 * time.Millisecond
)

type service struct {
	Name         string
	Aliases      []string
	Script       string
	ProbeURL     string
	DisplayURL   string
	StartTimeout time.Duration
}

type processState struct {
	Service   string `json:"service"`
	PID       int    `json:"pid"`
	StartedAt string `json:"started_at"`
	Command   string `json:"command"`
	LogPath   string `json:"log_path"`
}

type controller struct {
	repoRoot   string
	moduleRoot string
	stateDir   string
	logDir     string
	services   []service
	aliases    map[string]service
}

type usageError struct {
	message string
}

func (err usageError) Error() string {
	return err.message
}

func main() {
	c, err := newController()
	if err != nil {
		fmt.Fprintf(os.Stderr, "runctl: %v\n", err)
		os.Exit(1)
	}

	if err := c.run(os.Args[1:]); err != nil {
		var usage usageError
		if errors.As(err, &usage) {
			if usage.message != "" {
				fmt.Fprintf(os.Stderr, "%s\n\n", usage.message)
			}
			c.printUsage(os.Stderr)
			os.Exit(2)
		}
		fmt.Fprintf(os.Stderr, "runctl: %v\n", err)
		os.Exit(1)
	}
}

func newController() (*controller, error) {
	moduleRoot, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	moduleRoot, err = filepath.Abs(moduleRoot)
	if err != nil {
		return nil, err
	}

	repoRoot := os.Getenv("ARCADE_RUN_REPO_ROOT")
	if repoRoot == "" {
		repoRoot = filepath.Join(moduleRoot, "..", "..")
	}
	repoRoot, err = filepath.Abs(repoRoot)
	if err != nil {
		return nil, err
	}

	stateDir := os.Getenv("ARCADE_RUN_STATE_DIR")
	if stateDir == "" {
		stateDir = filepath.Join(repoRoot, ".arcade", "run")
	}
	stateDir, err = filepath.Abs(stateDir)
	if err != nil {
		return nil, err
	}

	logDir := os.Getenv("ARCADE_RUN_LOG_DIR")
	if logDir == "" {
		logDir = filepath.Join(repoRoot, ".arcade", "log")
	}
	logDir, err = filepath.Abs(logDir)
	if err != nil {
		return nil, err
	}

	services := []service{
		{
			Name:         "backend",
			Aliases:      []string{"back", "api"},
			Script:       filepath.Join("services", "backend.sh"),
			ProbeURL:     "http://127.0.0.1:8080/api/health",
			DisplayURL:   "http://localhost:8080",
			StartTimeout: defaultStartTimeout,
		},
		{
			Name:         "frontend",
			Aliases:      []string{"front", "web", "vite"},
			Script:       filepath.Join("services", "frontend.sh"),
			ProbeURL:     "http://127.0.0.1:5173/",
			DisplayURL:   "http://127.0.0.1:5173",
			StartTimeout: defaultStartTimeout,
		},
	}

	aliases := map[string]service{}
	for _, svc := range services {
		aliases[svc.Name] = svc
		for _, alias := range svc.Aliases {
			aliases[alias] = svc
		}
	}

	return &controller{
		repoRoot:   repoRoot,
		moduleRoot: moduleRoot,
		stateDir:   stateDir,
		logDir:     logDir,
		services:   services,
		aliases:    aliases,
	}, nil
}

func (c *controller) run(args []string) error {
	if len(args) == 0 {
		return c.startTarget("all")
	}

	command := normalizeCommand(args[0])
	if command == "" {
		return usageError{message: fmt.Sprintf("unknown command: %s", args[0])}
	}
	if command == "help" {
		c.printUsage(os.Stdout)
		return nil
	}
	if len(args) > 2 {
		return usageError{message: "too many arguments"}
	}

	target := "all"
	if len(args) == 2 {
		target = args[1]
	}

	switch command {
	case "start":
		return c.startTarget(target)
	case "stop":
		return c.stopTarget(target)
	case "restart":
		return c.restartTarget(target)
	case "status":
		return c.statusTarget(target)
	case "logs":
		return c.logsTarget(target)
	case "tail":
		return c.tailTarget(target)
	default:
		return usageError{message: fmt.Sprintf("unknown command: %s", args[0])}
	}
}

func normalizeCommand(command string) string {
	switch command {
	case "start", "up":
		return "start"
	case "stop", "down":
		return "stop"
	case "restart":
		return "restart"
	case "status", "ps":
		return "status"
	case "logs", "log":
		return "logs"
	case "tail", "follow":
		return "tail"
	case "help", "-h", "--help":
		return "help"
	default:
		return ""
	}
}

func (c *controller) printUsage(output io.Writer) {
	fmt.Fprint(output, `Usage:
  ./run.sh
  ./run.sh start [all|backend|frontend]
  ./run.sh stop [all|backend|frontend]
  ./run.sh restart [all|backend|frontend]
  ./run.sh status [all|backend|frontend]
  ./run.sh logs [all|backend|frontend]
  ./run.sh tail [all|backend|frontend]

With no arguments, ./run.sh starts both services and exits.
`)
}

func (c *controller) startTarget(target string) error {
	services, err := c.servicesForTarget(target, false)
	if err != nil {
		return err
	}
	for _, svc := range services {
		if err := c.startService(svc); err != nil {
			return err
		}
	}
	return nil
}

func (c *controller) stopTarget(target string) error {
	services, err := c.servicesForTarget(target, true)
	if err != nil {
		return err
	}

	var firstErr error
	for _, svc := range services {
		if err := c.stopService(svc); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (c *controller) restartTarget(target string) error {
	if err := c.stopTarget(target); err != nil {
		return err
	}
	return c.startTarget(target)
}

func (c *controller) statusTarget(target string) error {
	services, err := c.servicesForTarget(target, false)
	if err != nil {
		return err
	}

	fmt.Printf("%-10s %-20s %s\n", "SERVICE", "STATE", "DETAIL")
	for _, svc := range services {
		state, detail := c.serviceStatus(svc)
		fmt.Printf("%-10s %-20s %s\n", svc.Name, state, detail)
	}
	return nil
}

func (c *controller) logsTarget(target string) error {
	services, err := c.servicesForTarget(target, false)
	if err != nil {
		return err
	}

	for _, svc := range services {
		fmt.Printf("%-10s %s\n", svc.Name, c.logPath(svc))
	}
	return nil
}

func (c *controller) tailTarget(target string) error {
	services, err := c.servicesForTarget(target, false)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(c.logDir, 0o755); err != nil {
		return err
	}

	args := []string{"-n", "80", "-f"}
	for _, svc := range services {
		path := c.logPath(svc)
		file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return err
		}
		if err := file.Close(); err != nil {
			return err
		}
		args = append(args, path)
	}

	cmd := exec.Command("tail", args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func (c *controller) servicesForTarget(target string, reverse bool) ([]service, error) {
	normalized := strings.ToLower(strings.TrimSpace(target))
	if normalized == "" || normalized == "all" {
		services := append([]service(nil), c.services...)
		if reverse {
			reverseServices(services)
		}
		return services, nil
	}

	svc, ok := c.aliases[normalized]
	if !ok {
		return nil, usageError{message: fmt.Sprintf("unknown service: %s", target)}
	}
	return []service{svc}, nil
}

func reverseServices(services []service) {
	for left, right := 0, len(services)-1; left < right; left, right = left+1, right-1 {
		services[left], services[right] = services[right], services[left]
	}
}

func (c *controller) startService(svc service) error {
	state, err := c.loadState(svc)
	if err != nil {
		return err
	}
	if state != nil {
		if processAlive(state.PID) {
			if c.probe(svc) {
				fmt.Printf("%s already running at %s (pid %d)\n", svc.Name, svc.DisplayURL, state.PID)
				return nil
			}
			return fmt.Errorf("%s has managed pid %d but is not healthy; inspect %s or run ./run.sh restart %s", svc.Name, state.PID, c.logPath(svc), svc.Name)
		}
		if err := c.removeState(svc); err != nil {
			return err
		}
		fmt.Printf("%s had stale pid %d; cleaned state\n", svc.Name, state.PID)
	}

	if c.probe(svc) {
		fmt.Printf("%s is reachable at %s without managed state; leaving it alone\n", svc.Name, svc.DisplayURL)
		return nil
	}

	if err := os.MkdirAll(c.stateDir, 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(c.logDir, 0o755); err != nil {
		return err
	}

	scriptPath := filepath.Join(c.moduleRoot, svc.Script)
	if _, err := os.Stat(scriptPath); err != nil {
		return fmt.Errorf("%s start script is unavailable: %w", svc.Name, err)
	}

	logPath := c.logPath(svc)
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer logFile.Close()

	fmt.Fprintf(logFile, "\n==> %s start %s\n", svc.Name, time.Now().Format(time.RFC3339))

	cmd := exec.Command(scriptPath)
	cmd.Dir = c.repoRoot
	cmd.Env = append(os.Environ(),
		"ARCADE_RUN_REPO_ROOT="+c.repoRoot,
		"ARCADE_RUN_STATE_DIR="+c.stateDir,
		"ARCADE_RUN_LOG_DIR="+c.logDir,
	)
	cmd.Stdin = nil
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	configureDetachedProcess(cmd)

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", svc.Name, err)
	}

	pid := cmd.Process.Pid
	state = &processState{
		Service:   svc.Name,
		PID:       pid,
		StartedAt: time.Now().UTC().Format(time.RFC3339),
		Command:   scriptPath,
		LogPath:   logPath,
	}
	if err := c.writeState(svc, state); err != nil {
		_ = signalProcessGroup(pid, terminateSignal())
		return err
	}
	if err := cmd.Process.Release(); err != nil {
		return err
	}

	fmt.Printf("starting %s (pid %d)\n", svc.Name, pid)
	return c.waitForStart(svc, pid)
}

func (c *controller) stopService(svc service) error {
	state, err := c.loadState(svc)
	if err != nil {
		return err
	}
	if state == nil {
		if c.probe(svc) {
			fmt.Printf("%s is reachable at %s without managed state; leaving it alone\n", svc.Name, svc.DisplayURL)
			return nil
		}
		fmt.Printf("%s already stopped\n", svc.Name)
		return nil
	}

	if !processAlive(state.PID) {
		if err := c.removeState(svc); err != nil {
			return err
		}
		fmt.Printf("%s was already stopped; cleaned stale pid %d\n", svc.Name, state.PID)
		return nil
	}

	fmt.Printf("stopping %s (pid %d)\n", svc.Name, state.PID)
	if err := signalProcessGroup(state.PID, terminateSignal()); err != nil && processAlive(state.PID) {
		return err
	}
	if waitForExit(state.PID, 5*time.Second) {
		if err := c.removeState(svc); err != nil {
			return err
		}
		fmt.Printf("%s stopped\n", svc.Name)
		return nil
	}

	if err := signalProcessGroup(state.PID, killSignal()); err != nil && processAlive(state.PID) {
		return err
	}
	if waitForExit(state.PID, 2*time.Second) {
		if err := c.removeState(svc); err != nil {
			return err
		}
		fmt.Printf("%s stopped after forced shutdown\n", svc.Name)
		return nil
	}

	return fmt.Errorf("%s did not stop; pid %d is still alive", svc.Name, state.PID)
}

func (c *controller) serviceStatus(svc service) (string, string) {
	state, err := c.loadState(svc)
	if err != nil {
		return "error", err.Error()
	}

	healthy := c.probe(svc)
	if state == nil {
		if healthy {
			return "reachable", fmt.Sprintf("unmanaged at %s", svc.DisplayURL)
		}
		return "stopped", fmt.Sprintf("log %s", c.logPath(svc))
	}

	if !processAlive(state.PID) {
		if err := c.removeState(svc); err != nil {
			return "stale", fmt.Sprintf("pid %d; failed to clean state: %v", state.PID, err)
		}
		return "stopped", fmt.Sprintf("cleaned stale pid %d", state.PID)
	}

	if healthy {
		return "running", fmt.Sprintf("pid %d at %s", state.PID, svc.DisplayURL)
	}
	return "starting/unhealthy", fmt.Sprintf("pid %d; log %s", state.PID, c.logPath(svc))
}

func (c *controller) waitForStart(svc service, pid int) error {
	deadline := time.Now().Add(svc.StartTimeout)
	for {
		if c.probe(svc) {
			fmt.Printf("%s ready at %s\n", svc.Name, svc.DisplayURL)
			fmt.Printf("%s logs: %s\n", svc.Name, c.logPath(svc))
			return nil
		}
		if !processAlive(pid) {
			_ = c.removeState(svc)
			return fmt.Errorf("%s exited before becoming ready; see %s", svc.Name, c.logPath(svc))
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("%s did not become ready within %s; see %s", svc.Name, svc.StartTimeout, c.logPath(svc))
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func waitForExit(pid int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		if !processAlive(pid) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func (c *controller) probe(svc service) bool {
	client := http.Client{Timeout: defaultHTTPTimeout}
	response, err := client.Get(svc.ProbeURL)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
	return response.StatusCode >= 200 && response.StatusCode < 400
}

func (c *controller) loadState(svc service) (*processState, error) {
	path := c.statePath(svc)
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var state processState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	if state.Service != svc.Name {
		return nil, fmt.Errorf("read %s: expected service %s, got %s", path, svc.Name, state.Service)
	}
	if state.PID <= 0 {
		return nil, fmt.Errorf("read %s: invalid pid %d", path, state.PID)
	}
	return &state, nil
}

func (c *controller) writeState(svc service, state *processState) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tmpPath := c.statePath(svc) + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, c.statePath(svc))
}

func (c *controller) removeState(svc service) error {
	err := os.Remove(c.statePath(svc))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (c *controller) statePath(svc service) string {
	return filepath.Join(c.stateDir, svc.Name+".json")
}

func (c *controller) logPath(svc service) string {
	return filepath.Join(c.logDir, svc.Name+".log")
}
