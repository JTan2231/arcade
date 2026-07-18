#!/usr/bin/env node
import { createInterface } from "node:readline";

import { BrowserExtractor, WorkerError } from "./lib/browser-extractor.mjs";

const extractor = new BrowserExtractor();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
let closing = false;

function respond(value) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(value)}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function errorPayload(error) {
  if (error instanceof WorkerError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

async function processRequest(request) {
  const id = request?.id ?? null;
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    await respond({
      id,
      ok: false,
      error: { code: "invalid_request", message: "request must be an object" },
    });
    return;
  }
  try {
    switch (request.op) {
      case "extract": {
        const result = await extractor.extract(request);
        await respond({ id, ok: true, result });
        break;
      }
      case "stats": {
        const result = await extractor.stats();
        await respond({ id, ok: true, result });
        break;
      }
      case "shutdown": {
        closing = true;
        input.close();
        await extractor.close();
        await respond({ id, ok: true, result: { shutdown: true } });
        break;
      }
      default:
        throw new WorkerError(
          "unsupported_operation",
          "op must be extract, stats, or shutdown",
        );
    }
  } catch (error) {
    if (!(error instanceof WorkerError)) {
      process.stderr.write(
        `aozora worker internal error: ${error?.stack ?? String(error)}\n`,
      );
    }
    await respond({ id, ok: false, error: errorPayload(error) });
  }
}

input.on("line", (line) => {
  if (closing || line.trim() === "") return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    queue = queue.then(() =>
      respond({
        id: null,
        ok: false,
        error: {
          code: "invalid_json",
          message: "input line is not valid JSON",
        },
      }),
    );
    return;
  }
  queue = queue.then(() => processRequest(request));
});

input.on("close", () => {
  queue = queue.then(() => extractor.close());
});

async function stop(signal) {
  if (closing) return;
  closing = true;
  input.close();
  await queue.catch(() => {});
  await extractor.close();
  process.exitCode = signal === "SIGINT" ? 130 : 143;
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

await new Promise((resolve) => process.once("beforeExit", resolve));
