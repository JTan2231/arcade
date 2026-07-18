package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"arcade/internal/aozoracatalog"
)

const usageText = `Usage:
  aozora-catalog build OUTPUT_DIRECTORY [--source DIRECTORY]
  aozora-catalog upload OUTPUT_DIRECTORY [--dry-run]

Environment:
  AOZORA_ROOT                  Aozora source root when --source is omitted
  ARCADE_BASE_URL              Arcade base URL (default: http://localhost:8080)
  ARCADE_CATALOG_IMPORT_TOKEN  Required bearer token for upload
`

type command struct {
	subcommand      string
	outputDirectory string
	source          string
	sourceSet       bool
	dryRun          bool
	help            bool
}

type commandDependencies struct {
	build       func(context.Context, aozoracatalog.BuildOptions) (aozoracatalog.BuildReport, error)
	upload      func(context.Context, string, aozoracatalog.UploadOptions) (aozoracatalog.UploadResult, error)
	lookupEnv   func(string) (string, bool)
	userHomeDir func() (string, error)
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	os.Exit(run(ctx, os.Args[1:], os.Stdout, os.Stderr, commandDependencies{
		build:       aozoracatalog.Build,
		upload:      aozoracatalog.Upload,
		lookupEnv:   os.LookupEnv,
		userHomeDir: os.UserHomeDir,
	}))
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer, dependencies commandDependencies) int {
	parsed, err := parseCommand(args)
	if err != nil {
		fmt.Fprintf(stderr, "aozora-catalog: %v\n\n", err)
		fmt.Fprint(stderr, usageText)
		return 2
	}
	if parsed.help {
		fmt.Fprint(stdout, usageText)
		return 0
	}

	switch parsed.subcommand {
	case "build":
		return runBuild(ctx, parsed, stdout, stderr, dependencies)
	case "upload":
		return runUpload(ctx, parsed, stdout, stderr, dependencies)
	default:
		panic("parseCommand returned an unknown subcommand")
	}
}

func runBuild(ctx context.Context, parsed command, stdout, stderr io.Writer, dependencies commandDependencies) int {
	sourceRoot, err := resolveSourceRoot(parsed, dependencies)
	if err != nil {
		return reportCommandError(stderr, "build", err)
	}

	report, err := dependencies.build(ctx, aozoracatalog.BuildOptions{
		SourceRoot:      sourceRoot,
		OutputDirectory: parsed.outputDirectory,
		WorkerStderr:    stderr,
		Progress: func(processed, total int, htmlPath string) {
			fmt.Fprintf(stderr, "build: %d/%d %s\n", processed, total, htmlPath)
		},
	})
	if err != nil {
		return reportCommandError(stderr, "build", err)
	}
	if err := json.NewEncoder(stdout).Encode(report); err != nil {
		return reportCommandError(stderr, "build", fmt.Errorf("write report: %w", err))
	}
	return 0
}

func runUpload(ctx context.Context, parsed command, stdout, stderr io.Writer, dependencies commandDependencies) int {
	token, _ := dependencies.lookupEnv("ARCADE_CATALOG_IMPORT_TOKEN")
	if strings.TrimSpace(token) == "" {
		return reportCommandError(stderr, "upload", errors.New("ARCADE_CATALOG_IMPORT_TOKEN is required"))
	}
	baseURL, _ := dependencies.lookupEnv("ARCADE_BASE_URL")

	result, err := dependencies.upload(ctx, parsed.outputDirectory, aozoracatalog.UploadOptions{
		BaseURL: baseURL,
		Token:   token,
		DryRun:  parsed.dryRun,
	})
	if err != nil {
		return reportCommandError(stderr, "upload", err)
	}

	output := result.Validation
	if !parsed.dryRun {
		if result.Import == nil {
			return reportCommandError(stderr, "upload", errors.New("upload completed without an import result"))
		}
		output = *result.Import
	}
	if err := json.NewEncoder(stdout).Encode(output); err != nil {
		return reportCommandError(stderr, "upload", fmt.Errorf("write result: %w", err))
	}
	return 0
}

func reportCommandError(stderr io.Writer, subcommand string, err error) int {
	fmt.Fprintf(stderr, "aozora-catalog %s: %v\n", subcommand, err)
	return 1
}

func resolveSourceRoot(parsed command, dependencies commandDependencies) (string, error) {
	if parsed.sourceSet {
		return parsed.source, nil
	}
	if sourceRoot, ok := dependencies.lookupEnv("AOZORA_ROOT"); ok && sourceRoot != "" {
		return sourceRoot, nil
	}
	home, err := dependencies.userHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve default Aozora source root: %w", err)
	}
	if strings.TrimSpace(home) == "" {
		return "", errors.New("resolve default Aozora source root: home directory is empty")
	}
	return filepath.Join(home, "jp", "aozorabunko"), nil
}

func parseCommand(args []string) (command, error) {
	if len(args) == 0 {
		return command{}, errors.New("a subcommand is required")
	}
	if args[0] == "-h" || args[0] == "--help" {
		if len(args) != 1 {
			return command{}, errors.New("help does not accept arguments")
		}
		return command{help: true}, nil
	}

	parsed := command{subcommand: args[0]}
	switch parsed.subcommand {
	case "build":
		return parseBuildCommand(parsed, args[1:])
	case "upload":
		return parseUploadCommand(parsed, args[1:])
	default:
		return command{}, fmt.Errorf("unknown subcommand %q; expected build or upload", args[0])
	}
}

func parseBuildCommand(parsed command, args []string) (command, error) {
	positionals := make([]string, 0, 1)
	for index := 0; index < len(args); index++ {
		argument := args[index]
		switch {
		case argument == "-h" || argument == "--help":
			return command{help: true}, nil
		case argument == "--":
			positionals = append(positionals, args[index+1:]...)
			index = len(args)
		case argument == "--source":
			if parsed.sourceSet {
				return command{}, errors.New("build: --source may only be provided once")
			}
			if index+1 == len(args) {
				return command{}, errors.New("build: --source requires a directory")
			}
			index++
			parsed.source = args[index]
			parsed.sourceSet = true
		case strings.HasPrefix(argument, "--source="):
			if parsed.sourceSet {
				return command{}, errors.New("build: --source may only be provided once")
			}
			parsed.source = strings.TrimPrefix(argument, "--source=")
			if parsed.source == "" {
				return command{}, errors.New("build: --source requires a directory")
			}
			parsed.sourceSet = true
		case strings.HasPrefix(argument, "-"):
			return command{}, fmt.Errorf("build: unknown option %q", argument)
		default:
			positionals = append(positionals, argument)
		}
	}
	if parsed.sourceSet && strings.TrimSpace(parsed.source) == "" {
		return command{}, errors.New("build: --source requires a directory")
	}
	if len(positionals) == 0 {
		return command{}, errors.New("build: OUTPUT_DIRECTORY is required")
	}
	if len(positionals) > 1 {
		return command{}, fmt.Errorf("build: unexpected argument %q", positionals[1])
	}
	if strings.TrimSpace(positionals[0]) == "" {
		return command{}, errors.New("build: OUTPUT_DIRECTORY is required")
	}
	parsed.outputDirectory = positionals[0]
	return parsed, nil
}

func parseUploadCommand(parsed command, args []string) (command, error) {
	positionals := make([]string, 0, 1)
	for index := 0; index < len(args); index++ {
		argument := args[index]
		switch {
		case argument == "-h" || argument == "--help":
			return command{help: true}, nil
		case argument == "--":
			positionals = append(positionals, args[index+1:]...)
			index = len(args)
		case argument == "--dry-run":
			if parsed.dryRun {
				return command{}, errors.New("upload: --dry-run may only be provided once")
			}
			parsed.dryRun = true
		case strings.HasPrefix(argument, "-"):
			return command{}, fmt.Errorf("upload: unknown option %q", argument)
		default:
			positionals = append(positionals, argument)
		}
	}
	if len(positionals) == 0 {
		return command{}, errors.New("upload: OUTPUT_DIRECTORY is required")
	}
	if len(positionals) > 1 {
		return command{}, fmt.Errorf("upload: unexpected argument %q", positionals[1])
	}
	if strings.TrimSpace(positionals[0]) == "" {
		return command{}, errors.New("upload: OUTPUT_DIRECTORY is required")
	}
	parsed.outputDirectory = positionals[0]
	return parsed, nil
}
