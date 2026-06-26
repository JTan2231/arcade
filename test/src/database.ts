import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

export type DisposableDatabase = {
  name: string;
  url: string;
  drop: () => Promise<void>;
};

export async function createDisposableDatabase(): Promise<DisposableDatabase> {
  const baseURL =
    process.env.ARCADE_TEST_DATABASE_URL ||
    process.env.ARCADE_DATABASE_URL ||
    defaultDatabaseURL;
  const databaseName = `arcade_test_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const databaseURL = databaseURLWithName(baseURL, databaseName);
  const adminURL = databaseURLWithName(baseURL, "postgres");
  const quotedName = quoteIdentifier(databaseName);

  await runCommand("psql", [
    "-v",
    "ON_ERROR_STOP=1",
    "-d",
    adminURL,
    "-c",
    `create database ${quotedName}`,
  ]);

  let dropped = false;
  return {
    name: databaseName,
    url: databaseURL,
    drop: async () => {
      if (dropped) {
        return;
      }
      dropped = true;
      await runCommand("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        adminURL,
        "-c",
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = ${quoteLiteral(databaseName)} and pid <> pg_backend_pid()`,
      ]);
      await runCommand("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        adminURL,
        "-c",
        `drop database if exists ${quotedName}`,
      ]);
    },
  };
}

const defaultDatabaseURL = "postgres://localhost:5432/arcade?sslmode=disable";

function databaseURLWithName(rawURL: string, databaseName: string): string {
  const url = new URL(rawURL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) {
    throw new Error(`unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
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
