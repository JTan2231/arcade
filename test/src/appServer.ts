import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { createDisposableDatabase, type DisposableDatabase } from "./database";

export type AppServer = {
  baseURL: string;
  databaseURL: string;
  logPath: string;
  stop: () => Promise<void>;
};

type StartAppServerOptions = {
  repoRoot: string;
  artifactsDir: string;
};

export async function startAppServer(
  options: StartAppServerOptions,
): Promise<AppServer> {
  await runCommand("bun", ["run", "build"], {
    cwd: path.join(options.repoRoot, "web/frontend"),
  });

  const database = await createDisposableDatabase();
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const logPath = path.join(options.artifactsDir, "app-server.log");
  await mkdir(options.artifactsDir, { recursive: true });

  const logStream = createWriteStream(logPath, { flags: "a" });
  const child = spawn("go", ["run", "./cmd/arcade"], {
    cwd: options.repoRoot,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ARCADE_ADDR: `127.0.0.1:${port}`,
      ARCADE_DATABASE_URL: database.url,
      ARCADE_CATALOG_IMPORT_TOKEN:
        process.env.ARCADE_CATALOG_IMPORT_TOKEN || "arcade-test-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  try {
    await waitForHealth(baseURL, child);
  } catch (error) {
    await stopServer(child, logStream, database);
    throw error;
  }

  return {
    baseURL,
    databaseURL: database.url,
    logPath,
    stop: async () => {
      await stopServer(child, logStream, database);
    },
  };
}

async function waitForHealth(
  baseURL: string,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `app server exited before becoming healthy: code=${child.exitCode} signal=${child.signalCode}`,
      );
    }

    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }

    await sleep(250);
  }

  throw new Error("app server did not become healthy within 60s");
}

async function stopServer(
  child: ChildProcess,
  logStream: WriteStream,
  database: DisposableDatabase,
): Promise<void> {
  const serverStopped = stopProcess(child);
  await serverStopped.catch(() => undefined);
  await new Promise<void>((resolve) => {
    logStream.end(resolve);
  });
  await database.drop();
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => {
      signalProcess(child, "SIGKILL");
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    signalProcess(child, "SIGTERM");
  });
}

function signalProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    child.kill(signal);
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("could not allocate a TCP port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
