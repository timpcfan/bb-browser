/**
 * bb-browser Daemon — CDP-direct backend
 *
 * Unified daemon that handles ALL browser commands (operations + observation)
 * via direct Chrome DevTools Protocol connection.
 *
 * Two-phase startup:
 *   1. HTTP server starts immediately (commands queue until CDP is ready)
 *   2. CDP connection established asynchronously
 */

import { parseArgs } from "node:util";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { DAEMON_PORT, DAEMON_HOST } from "@bb-browser/shared";
import { HttpServer } from "./http-server.js";
import { CdpConnection } from "./cdp-connection.js";
import { TabStateManager } from "./tab-state.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PID_FILE_PATH = "/tmp/bb-browser.pid";
const DAEMON_DIR = path.join(os.homedir(), ".bb-browser");
const TOKEN_FILE = path.join(DAEMON_DIR, "daemon.token");
const DEFAULT_CDP_PORT = 19888;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface DaemonOptions {
  host: string;
  port: number;
  cdpHost: string;
  cdpPort: number;
  token: string;
}

function parseOptions(): DaemonOptions {
  const { values } = parseArgs({
    allowPositionals: true,
    options: {
      host: {
        type: "string",
        short: "H",
        default: DAEMON_HOST,
      },
      port: {
        type: "string",
        short: "p",
        default: String(DAEMON_PORT),
      },
      "cdp-host": {
        type: "string",
        default: "127.0.0.1",
      },
      "cdp-port": {
        type: "string",
        default: String(DEFAULT_CDP_PORT),
      },
      token: {
        type: "string",
        default: "",
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
    },
  });

  if (values.help) {
    console.error(`
bb-browser-daemon — CDP-direct backend for bb-browser

Usage:
  bb-browser-daemon [options]

Options:
  -H, --host <host>          HTTP server host (default: ${DAEMON_HOST})
  -p, --port <port>          HTTP server port (default: ${DAEMON_PORT})
      --cdp-host <host>      Chrome CDP host (default: 127.0.0.1)
      --cdp-port <port>      Chrome CDP port (default: ${DEFAULT_CDP_PORT})
      --token <token>        Bearer auth token (auto-generated if empty)
  -h, --help                 Show this help message

Endpoints:
  POST /command      Send command and get result (via CDP)
  GET  /status       Daemon health + per-tab stats
  POST /shutdown     Graceful shutdown
`);
    process.exit(0);
  }

  // Auto-generate token if not provided
  let token = values.token ?? "";
  if (!token) {
    token = randomBytes(16).toString("hex");
  }

  return {
    host: values.host ?? DAEMON_HOST,
    port: parseInt(values.port ?? String(DAEMON_PORT), 10),
    cdpHost: values["cdp-host"] ?? "127.0.0.1",
    cdpPort: parseInt(values["cdp-port"] ?? String(DEFAULT_CDP_PORT), 10),
    token,
  };
}

// ---------------------------------------------------------------------------
// PID / token file management
// ---------------------------------------------------------------------------

function writePidFile(): void {
  writeFileSync(PID_FILE_PATH, String(process.pid), "utf-8");
}

function cleanupPidFile(): void {
  if (existsSync(PID_FILE_PATH)) {
    try {
      unlinkSync(PID_FILE_PATH);
    } catch {}
  }
}

function writeTokenFile(token: string): void {
  try {
    mkdirSync(DAEMON_DIR, { recursive: true });
    writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  } catch {}
}

function cleanupTokenFile(): void {
  if (existsSync(TOKEN_FILE)) {
    try {
      unlinkSync(TOKEN_FILE);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// CDP port discovery (simplified — daemon is told the port)
// ---------------------------------------------------------------------------

async function discoverCdpPort(host: string, port: number): Promise<{ host: string; port: number }> {
  // 优先级1: 指定端口
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`http://${host}:${port}/json/version`, {
        signal: controller.signal,
      });
      if (response.ok) {
        return { host, port };
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {}

  // 优先级2: OpenClaw
  try {
    const { execFileSync } = await import("node:child_process");
    const raw = execFileSync("npx", ["openclaw", "browser", "status"], {
      encoding: "utf8",
      timeout: 10000,
    });
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^cdpPort:\s*(\d+)/);
      if (match) {
        const openClawPort = parseInt(match[1], 10);
        if (openClawPort > 0) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 2000);
            try {
              const resp = await fetch(`http://127.0.0.1:${openClawPort}/json/version`, {
                signal: ctrl.signal,
              });
              if (resp.ok) {
                console.error(`[Daemon] Found OpenClaw Chrome at ${openClawPort}`);
                return { host: "127.0.0.1", port: openClawPort };
              }
            } finally {
              clearTimeout(t);
            }
          } catch {}
        }
      }
    }
  } catch {}

  // 优先级3: Managed port file
  const managedPortFile = path.join(os.homedir(), ".bb-browser", "browser", "cdp-port");
  try {
    const rawPort = readFileSync(managedPortFile, "utf8").trim();
    const managedPort = parseInt(rawPort, 10);
    if (Number.isInteger(managedPort) && managedPort > 0) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        try {
          const response = await fetch(`http://127.0.0.1:${managedPort}/json/version`, {
            signal: controller.signal,
          });
          if (response.ok) {
            return { host: "127.0.0.1", port: managedPort };
          }
        } finally {
          clearTimeout(timer);
        }
      } catch {}
    }
  } catch {}

  // 优先级4: Spawn headless Chrome
  try {
    const { spawn } = await import("node:child_process");
    const chromePaths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
    let chromePath = "";
    for (const p of chromePaths) {
      try {
        const { statSync } = await import("node:fs");
        statSync(p);
        chromePath = p;
        break;
      } catch {}
    }
    if (!chromePath) {
      throw new Error("Chrome not found");
    }

    const headlessDataDir = path.join(os.tmpdir(), "bb-browser-headless", String(port));
    const { mkdirSync } = await import("node:fs");
    mkdirSync(headlessDataDir, { recursive: true });

    const chromeArgs = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${headlessDataDir}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
    ];

    const child = spawn(chromePath, chromeArgs, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Wait for Chrome to start
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(1000),
        });
        if (resp.ok) {
          console.error(`[Daemon] Headless Chrome spawned at ${port}`);
          return { host: "127.0.0.1", port };
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) {
    console.error(`[Daemon] Failed to spawn headless Chrome: ${e}`);
  }

  throw new Error(
    `Cannot connect to Chrome CDP at ${host}:${port}. ` +
    `Make sure Chrome is running with --remote-debugging-port=${port}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseOptions();

  // Create tab state manager and CDP connection
  const tabManager = new TabStateManager();
  let cdpEndpoint: { host: string; port: number };

  try {
    cdpEndpoint = await discoverCdpPort(options.cdpHost, options.cdpPort);
  } catch (error) {
    console.error(
      `[Daemon] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  const cdp = new CdpConnection(cdpEndpoint.host, cdpEndpoint.port, tabManager);

  // Graceful shutdown handler (guarded against double-call)
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error("[Daemon] Shutting down...");
    cdp.disconnect();
    await httpServer.stop();
    cleanupPidFile();
    cleanupTokenFile();
    process.exit(0);
  };

  // Phase 1: Start HTTP server immediately
  const httpServer = new HttpServer({
    host: options.host,
    port: options.port,
    token: options.token,
    cdp,
    onShutdown: shutdown,
  });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await httpServer.start();
  writePidFile();
  writeTokenFile(options.token);

  console.error(
    `[Daemon] HTTP server listening on http://${options.host}:${options.port}`,
  );
  console.error(`[Daemon] Auth token: ${options.token}`);

  // Phase 2: Connect to CDP asynchronously
  console.error(
    `[Daemon] Connecting to Chrome CDP at ${cdpEndpoint.host}:${cdpEndpoint.port}...`,
  );

  try {
    await cdp.connect();
    const tabCount = tabManager.tabCount;
    console.error(
      `[Daemon] CDP connected, monitoring ${tabCount} tab(s)`,
    );
  } catch (error) {
    console.error(
      `[Daemon] Failed to connect to CDP: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error("[Daemon] HTTP server is running, but commands will fail until CDP connects.");
  }
}

main().catch((error) => {
  console.error("[Daemon] Fatal error:", error);
  cleanupPidFile();
  cleanupTokenFile();
  process.exit(1);
});
