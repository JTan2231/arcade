import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
} from "@playwright/test";

import { startAppServer, type AppServer } from "../appServer";
import {
  createPrimitiveContext,
  disposePrimitiveContext,
  type PrimitiveContext,
} from "../context";
import { initialVariables } from "../interpolation";
import { NetworkController } from "../networkControls";
import { parseScenarioFile, type LoadedScenario } from "../scenarioSchema";
import { createQuery, rankMatches, serializableMatch } from "./matching";
import { collectRuntimeCandidates } from "./runtime";
import { driveScenarioToState } from "./scenarioExecution";
import { buildSourceIndex } from "./sourceIndex";
import type {
  JoinedMatch,
  RuntimeCandidate,
  RuntimeCandidateSummary,
  SerializableJoinedMatch,
  SourceCandidate,
  SourceLocation,
} from "./types";

type CLIOptions = {
  query: string;
  path: string;
  project: string;
  all: boolean;
  json: boolean;
  open: boolean;
  noServer: boolean;
  baseURL?: string;
  scenarioFile?: string;
  afterStep?: number;
  role?: string;
  within?: string;
  artifactsDir?: string;
};

type LocatorResult = {
  query: string;
  baseURL: string;
  artifactsDir: string;
  selectedScreenshot?: string;
  pageScreenshot?: string;
  selected?: SerializableJoinedMatch;
  matches: SerializableJoinedMatch[];
  counts: {
    runtimeCandidates: number;
    sourceCandidates: number;
  };
  scenario?: {
    file: string;
    name: string;
    beforeSteps: number;
    scenarioSteps: number;
  };
  selectedSourceSnippet?: SourceSnippet;
  relatedSourceSnippets?: SourceSnippet[];
};

type SourceSnippet = {
  location: SourceLocation;
  lines: Array<{ number: number; text: string }>;
};

export async function main(args: string[], startDir: string): Promise<void> {
  const options = parseArgs(args);
  const repoRoot = findRepoRoot(startDir);
  const artifactsDir = await prepareArtifactsDir(options.artifactsDir);
  const sourceCandidates = buildSourceIndex(repoRoot);
  const sourceIndexPath = path.join(artifactsDir, "source-index.json");
  await writeJSON(sourceIndexPath, sourceCandidates);

  let appServer: AppServer | undefined;
  let browser: Browser | undefined;
  let browserContext: BrowserContext | undefined;
  let page: Page | undefined;
  let primitiveContext: PrimitiveContext | undefined;
  let network: NetworkController | undefined;

  try {
    const baseURL = await resolveBaseURL(
      options,
      repoRoot,
      artifactsDir,
      (server) => {
        appServer = server;
      },
    );
    const browserType = browserTypeForProject(options.project);
    browser = await browserType.launch();
    browserContext = await browser.newContext({
      baseURL,
      viewport: { width: 1280, height: 900 },
    });
    page = await browserContext.newPage();
    network = new NetworkController();
    primitiveContext = await createPrimitiveContext({
      baseURL,
      ...(appServer === undefined
        ? {}
        : { databaseURL: appServer.databaseURL }),
      page,
      variables: initialVariables(undefined),
      network,
    });
    await network.attach(page);

    const scenarioState = await driveToRequestedState(
      options,
      repoRoot,
      primitiveContext,
    );
    await page
      .waitForLoadState("networkidle", { timeout: 2_000 })
      .catch(() => undefined);

    const runtimeCandidates = await collectRuntimeCandidates(page);
    const runtimePath = path.join(artifactsDir, "runtime-candidates.json");
    await writeJSON(
      runtimePath,
      runtimeCandidates.map((candidate) => runtimeSummary(candidate)),
    );

    const query = createQuery(options.query, {
      role: options.role,
      within: options.within,
    });
    const matches = rankMatches(query, runtimeCandidates, sourceCandidates);
    const selected = matches[0];
    const pageScreenshot = path.join(artifactsDir, "page.png");
    await page
      .screenshot({ path: pageScreenshot, fullPage: true })
      .catch(() => undefined);

    const selectedScreenshot =
      selected?.runtime?.candidate.visible === true
        ? path.join(artifactsDir, "selected.png")
        : undefined;
    if (selectedScreenshot !== undefined) {
      await selected?.runtime?.candidate.locator
        .screenshot({ path: selectedScreenshot })
        .catch(() => undefined);
    }

    const printedMatches = matches.slice(0, options.all ? matches.length : 8);
    const selectedSource = selected?.source?.candidate;
    const selectedSourceSnippet =
      selectedSource === undefined
        ? undefined
        : await sourceSnippet(repoRoot, selectedSource.source);
    const relatedSourceSnippets =
      selectedSource === undefined
        ? undefined
        : await Promise.all(
            selectedSource.relatedSources.map((related) =>
              sourceSnippet(repoRoot, related.location),
            ),
          );
    const result: LocatorResult = {
      query: options.query,
      baseURL,
      artifactsDir,
      ...(selectedScreenshot === undefined ? {} : { selectedScreenshot }),
      pageScreenshot,
      ...(selected === undefined
        ? {}
        : { selected: serializableMatch(selected) }),
      matches: printedMatches.map(serializableMatch),
      counts: {
        runtimeCandidates: runtimeCandidates.length,
        sourceCandidates: sourceCandidates.length,
      },
      ...(scenarioState === undefined ? {} : { scenario: scenarioState }),
      ...(selectedSourceSnippet === undefined ? {} : { selectedSourceSnippet }),
      ...(relatedSourceSnippets === undefined ||
      relatedSourceSnippets.length === 0
        ? {}
        : { relatedSourceSnippets }),
    };

    const resultPath = path.join(artifactsDir, "result.json");
    await writeJSON(resultPath, result);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printResult(result, matches, repoRoot);
    }

    if (options.open) {
      openArtifact(selectedScreenshot ?? pageScreenshot);
    }
  } finally {
    await disposePrimitiveContextIfPresent(primitiveContext);
    await network?.cleanup().catch(() => undefined);
    await browserContext?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await appServer?.stop().catch(() => undefined);
  }
}

function parseArgs(args: string[]): CLIOptions {
  const options: Omit<CLIOptions, "query"> = {
    path: "/",
    project: "chromium",
    all: false,
    json: false,
    open: false,
    noServer: false,
  };
  const queryParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    const [flag, inlineValue] = splitFlag(arg);
    switch (flag) {
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
      case "--scenario":
        [options.scenarioFile, index] = requireValue(
          args,
          index,
          flag,
          inlineValue,
        );
        break;
      case "--after-step":
        {
          const [value, nextIndex] = requireValue(
            args,
            index,
            flag,
            inlineValue,
          );
          options.afterStep = parseNonnegativeInteger(value, flag);
          index = nextIndex;
        }
        break;
      case "--path":
        [options.path, index] = requireValue(args, index, flag, inlineValue);
        break;
      case "--within":
        [options.within, index] = requireValue(args, index, flag, inlineValue);
        break;
      case "--role":
        [options.role, index] = requireValue(args, index, flag, inlineValue);
        break;
      case "--project":
        [options.project, index] = requireValue(args, index, flag, inlineValue);
        break;
      case "--base-url":
        [options.baseURL, index] = requireValue(args, index, flag, inlineValue);
        break;
      case "--artifacts-dir":
        [options.artifactsDir, index] = requireValue(
          args,
          index,
          flag,
          inlineValue,
        );
        break;
      case "--all":
        options.all = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--open":
        options.open = true;
        break;
      case "--no-server":
        options.noServer = true;
        break;
      case "--update-index":
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`unknown option: ${arg}`);
        }
        queryParts.push(arg);
        break;
    }
  }

  const query = queryParts.join(" ").trim();
  if (query === "") {
    printUsage();
    throw new Error("query is required");
  }

  if (options.noServer && options.baseURL === undefined) {
    throw new Error("--no-server requires --base-url");
  }

  return {
    query,
    ...options,
  };
}

function splitFlag(arg: string): [string, string | undefined] {
  if (!arg.startsWith("--")) {
    return [arg, undefined];
  }
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex === -1) {
    return [arg, undefined];
  }
  return [arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1)];
}

function requireValue(
  args: string[],
  index: number,
  flag: string,
  inlineValue: string | undefined,
): [string, number] {
  if (inlineValue !== undefined) {
    return [inlineValue, index];
  }
  const nextIndex = index + 1;
  const value = args[nextIndex];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return [value, nextIndex];
}

function parseNonnegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a nonnegative integer`);
  }
  return parsed;
}

async function resolveBaseURL(
  options: CLIOptions,
  repoRoot: string,
  artifactsDir: string,
  setAppServer: (server: AppServer) => void,
): Promise<string> {
  if (options.baseURL !== undefined) {
    return options.baseURL;
  }
  if (options.noServer) {
    throw new Error("--no-server requires --base-url");
  }

  const server = await startAppServer({ repoRoot, artifactsDir });
  setAppServer(server);
  return server.baseURL;
}

async function driveToRequestedState(
  options: CLIOptions,
  repoRoot: string,
  context: PrimitiveContext,
): Promise<LocatorResult["scenario"] | undefined> {
  if (options.scenarioFile === undefined) {
    await context.page.goto(options.path, { waitUntil: "domcontentloaded" });
    return undefined;
  }

  const loaded = await loadScenario(repoRoot, options.scenarioFile);
  const counts = await driveScenarioToState(context, loaded, options.afterStep);
  return {
    file: loaded.file,
    name: loaded.scenario.name,
    beforeSteps: counts.beforeSteps,
    scenarioSteps: counts.scenarioSteps,
  };
}

async function loadScenario(
  repoRoot: string,
  scenarioFile: string,
): Promise<LoadedScenario> {
  const file = path.resolve(repoRoot, scenarioFile);
  const source = await readFile(file, "utf8");
  return parseScenarioFile(file, source);
}

function browserTypeForProject(project: string): BrowserType {
  switch (project) {
    case "chromium":
      return chromium;
    case "firefox":
      return firefox;
    case "webkit":
      return webkit;
    default:
      throw new Error(`unknown browser project: ${project}`);
  }
}

async function prepareArtifactsDir(
  configured: string | undefined,
): Promise<string> {
  if (configured === undefined) {
    return mkdtemp(path.join(os.tmpdir(), "arcade-locator-"));
  }

  const artifactsDir = path.resolve(configured);
  await mkdir(artifactsDir, { recursive: true });
  return artifactsDir;
}

function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (
      fsExists(path.join(current, "go.mod")) &&
      fsExists(path.join(current, "web/frontend")) &&
      fsExists(path.join(current, "test/src"))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`could not find Arcade repo root from ${startDir}`);
    }
    current = parent;
  }
}

function fsExists(candidate: string): boolean {
  return existsSync(candidate);
}

async function writeJSON(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function sourceSnippet(
  repoRoot: string,
  location: SourceLocation,
): Promise<SourceSnippet> {
  const filePath = path.join(repoRoot, location.file);
  const text = await readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const startLine = Math.max(1, location.startLine - 1);
  const endLine = Math.min(lines.length, location.endLine + 1);
  return {
    location,
    lines: lines.slice(startLine - 1, endLine).map((line, index) => ({
      number: startLine + index,
      text: line,
    })),
  };
}

function runtimeSummary(candidate: RuntimeCandidate): RuntimeCandidateSummary {
  const { locator: _locator, ...summary } = candidate;
  return summary;
}

function printResult(
  result: LocatorResult,
  matches: JoinedMatch[],
  repoRoot: string,
): void {
  process.stdout.write(`Query: ${result.query}\n`);
  process.stdout.write(`Artifacts: ${result.artifactsDir}\n`);
  if (result.scenario !== undefined) {
    process.stdout.write(
      `Scenario: ${result.scenario.name} (${result.scenario.scenarioSteps} steps)\n`,
    );
  }
  process.stdout.write("\n");

  if (result.selected === undefined) {
    process.stdout.write("No confident match found.\n");
    process.stdout.write(
      `Page screenshot: ${result.pageScreenshot ?? "not captured"}\n`,
    );
    return;
  }

  process.stdout.write("Selected:\n");
  printMatch(result.selected, "  ");
  if (result.selectedScreenshot !== undefined) {
    process.stdout.write(`  screenshot: ${result.selectedScreenshot}\n`);
  }
  if (result.pageScreenshot !== undefined) {
    process.stdout.write(`  page: ${result.pageScreenshot}\n`);
  }

  if (result.selectedSourceSnippet !== undefined) {
    process.stdout.write("\nSource:\n");
    printSnippet(result.selectedSourceSnippet, repoRoot, "  ");
  }

  if (
    result.relatedSourceSnippets !== undefined &&
    result.relatedSourceSnippets.length > 0
  ) {
    process.stdout.write("\nRelated label source:\n");
    for (const snippet of result.relatedSourceSnippets) {
      printSnippet(snippet, repoRoot, "  ");
    }
  }

  const closeMatches = matches.slice(1, 6).map(serializableMatch);
  if (closeMatches.length > 0) {
    process.stdout.write("\nClose matches:\n");
    for (const match of closeMatches) {
      printMatch(match, "  ");
    }
  }
}

function printMatch(match: SerializableJoinedMatch, indent: string): void {
  const runtime = match.runtime?.candidate;
  const source = match.source?.candidate;
  process.stdout.write(`${indent}score: ${match.score.toFixed(2)}\n`);
  if (runtime !== undefined) {
    process.stdout.write(
      `${indent}runtime: ${runtime.role} "${displayName(runtime)}"${regionSuffix(runtime.regionPath)}\n`,
    );
    if (runtime.bounds !== undefined) {
      process.stdout.write(
        `${indent}box: x=${Math.round(runtime.bounds.x)} y=${Math.round(runtime.bounds.y)} w=${Math.round(runtime.bounds.width)} h=${Math.round(runtime.bounds.height)}\n`,
      );
    }
  }
  if (source !== undefined) {
    process.stdout.write(
      `${indent}source: ${source.role} "${displayName(source)}" ${source.source.file}:${source.source.startLine}\n`,
    );
  }
}

function printSnippet(
  snippet: SourceSnippet,
  repoRoot: string,
  indent: string,
): void {
  const absolute = path.join(repoRoot, snippet.location.file);
  process.stdout.write(`${indent}${absolute}:${snippet.location.startLine}\n`);
  for (const line of consoleSnippetLines(snippet.lines)) {
    if (line.number === null) {
      process.stdout.write(`${indent}      ${line.text}\n`);
      continue;
    }
    process.stdout.write(
      `${indent}${String(line.number).padStart(4, " ")}  ${line.text}\n`,
    );
  }
}

function consoleSnippetLines(
  lines: SourceSnippet["lines"],
): Array<{ number: number | null; text: string }> {
  const maxLines = 32;
  if (lines.length <= maxLines) {
    return lines;
  }

  const headCount = 24;
  const tailCount = 4;
  const omitted = lines.length - headCount - tailCount;
  return [
    ...lines.slice(0, headCount),
    {
      number: null,
      text: `... ${omitted} lines omitted; full snippet is in result.json ...`,
    },
    ...lines.slice(-tailCount),
  ];
}

function displayName(candidate: {
  name: string;
  label?: string;
  text: string;
}): string {
  return firstNonEmpty(candidate.name, candidate.label, candidate.text);
}

function regionSuffix(regionPath: string[]): string {
  return regionPath.length === 0 ? "" : ` in ${regionPath.join(" > ")}`;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return "";
}

function openArtifact(file: string): void {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [file], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function disposePrimitiveContextIfPresent(
  context: PrimitiveContext | undefined,
): Promise<void> {
  if (context !== undefined) {
    await disposePrimitiveContext(context).catch(() => undefined);
  }
}

function printUsage(): void {
  process.stdout.write(`Usage: ./locator.ts [options] QUERY

Find a rendered UI element by fuzzy name, screenshot it, and report source lines.

Options:
  --scenario FILE       Run a YAML scenario before locating.
  --after-step N        Stop after N scenario steps. Default: all steps.
  --path PATH           Visit a route directly when no scenario is used. Default: /.
  --within NAME         Prefer matches inside this accessible region/dialog/main.
  --role ROLE           Restrict matches to one role, such as button or dialog.
  --project NAME        Browser project: chromium, firefox, or webkit. Default: chromium.
  --base-url URL        Inspect an already-running server.
  --no-server           Require --base-url and do not start/stop the app.
  --artifacts-dir DIR   Write artifacts to DIR. Default: a new OS temp directory.
  --all                 Include all ranked matches in result.json/stdout.
  --json                Print machine-readable JSON.
  --open                Open the selected screenshot, or page screenshot.
  --update-index        Accepted for symmetry; the index is built in memory each run.
`);
}
