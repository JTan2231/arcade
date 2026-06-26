#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startAppServer, type AppServer } from "./appServer";
import { runScenario, ScenarioRunError } from "./scenarioRunner";
import { parseScenarioFile, type LoadedScenario } from "./scenarioSchema";

type CLIOptions = {
  baseURL?: string;
  project: string;
  artifactsDir: string;
  scenarioFiles: string[];
};

const sourceDir = fileURLToPath(new URL(".", import.meta.url));
const testRoot = path.resolve(sourceDir, "..");
const repoRoot = path.resolve(testRoot, "..");

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const artifactsDir = path.resolve(repoRoot, options.artifactsDir);
  const scenarioFiles =
    options.scenarioFiles.length > 0
      ? options.scenarioFiles
      : await defaultScenarioFiles();
  const loadedScenarios = await loadScenarios(scenarioFiles);

  let appServer: AppServer | undefined;
  let baseURL = options.baseURL;
  if (baseURL === undefined) {
    appServer = await startAppServer({ repoRoot, artifactsDir });
    baseURL = appServer.baseURL;
  }

  let failures = 0;
  try {
    for (const loaded of loadedScenarios) {
      process.stdout.write(`\n==> Scenario: ${loaded.scenario.name}\n`);
      try {
        const result = await runScenario(loaded, {
          baseURL,
          project: options.project,
          artifactsDir,
          appLogPath: appServer?.logPath,
        });
        process.stdout.write(
          `passed ${result.stepCount} steps on ${result.project}\n`,
        );
      } catch (error) {
        failures += 1;
        reportScenarioFailure(error);
      }
    }
  } finally {
    await appServer?.stop();
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    project: "chromium",
    artifactsDir: "test/artifacts",
    scenarioFiles: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
      case "--base-url":
        options.baseURL = requireValue(args, ++index, "--base-url");
        break;
      case "--project":
        options.project = requireValue(args, ++index, "--project");
        break;
      case "--artifacts-dir":
        options.artifactsDir = requireValue(args, ++index, "--artifacts-dir");
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`unknown option: ${arg}`);
        }
        options.scenarioFiles.push(path.resolve(repoRoot, arg));
        break;
    }
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function defaultScenarioFiles(): Promise<string[]> {
  const scenarioDir = path.join(testRoot, "scenarios");
  const entries = await readdir(scenarioDir);
  return entries
    .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
    .sort()
    .map((entry) => path.join(scenarioDir, entry));
}

async function loadScenarios(files: string[]): Promise<LoadedScenario[]> {
  return Promise.all(
    files.map(async (file) => {
      const source = await readFile(file, "utf8");
      return parseScenarioFile(file, source);
    }),
  );
}

function reportScenarioFailure(error: unknown): void {
  if (!(error instanceof ScenarioRunError)) {
    process.stderr.write(
      error instanceof Error
        ? `${error.stack ?? error.message}\n`
        : `${String(error)}\n`,
    );
    return;
  }

  process.stderr.write(`failed: ${error.scenarioName}\n`);
  process.stderr.write(`file: ${error.scenarioFile}\n`);
  process.stderr.write(`browser: ${error.project}\n`);
  process.stderr.write(`steps: ${error.stepCount}\n`);
  process.stderr.write(`failed phase: ${error.failedPhase}\n`);
  process.stderr.write(`failed step: ${error.failedStepIndex + 1}\n`);
  if (error.failedStepID !== undefined) {
    process.stderr.write(`step id: ${error.failedStepID}\n`);
  }
  process.stderr.write(`error: ${error.message}\n`);
  process.stderr.write("step:\n");
  process.stderr.write(`${indent(error.stepSnippet)}\n`);
  process.stderr.write(`trace: ${error.tracePath}\n`);
  process.stderr.write(`screenshot: ${error.screenshotPath}\n`);
  if (error.appLogPath !== undefined) {
    process.stderr.write(`app logs: ${error.appLogPath}\n`);
  }
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function printUsage(): void {
  process.stdout.write(`Usage: bun run e2e [options] [scenario.yaml ...]

Options:
  --base-url URL        Run against an existing Arcade server instead of starting one.
  --project NAME        Browser project: chromium, firefox, or webkit. Default: chromium.
  --artifacts-dir DIR   Failure artifacts directory. Default: test/artifacts.
`);
}

await main().catch((error) => {
  process.stderr.write(
    error instanceof Error
      ? `${error.stack ?? error.message}\n`
      : `${String(error)}\n`,
  );
  process.exitCode = 1;
});
