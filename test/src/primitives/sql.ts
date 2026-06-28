import { spawn } from "node:child_process";

import type { PrimitiveContext } from "../context";
import { interpolateString } from "../interpolation";
import type { ScenarioStep } from "../scenarioSchema";

export async function executeSQLPrimitive(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.sql === undefined) {
    throw new Error("sql primitive is missing");
  }
  if (context.databaseURL === undefined) {
    throw new Error("sql primitive requires a harness-managed database");
  }

  await runCommand("psql", [
    "-v",
    "ON_ERROR_STOP=1",
    "-d",
    context.databaseURL,
    "-c",
    interpolateString(step.sql.statement, context.variables),
  ]);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code}\n${stderr || stdout}`,
        ),
      );
    });
  });
}
