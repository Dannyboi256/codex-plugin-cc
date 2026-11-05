import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { after } from "node:test";
import { spawnSync } from "node:child_process";

import {
  clearBrokerSession,
  loadBrokerSession,
  sendBrokerShutdown,
  teardownBrokerSession
} from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";
import { terminateProcessTree } from "../plugins/codex/scripts/lib/process.mjs";

// Workspaces created by initGitRepo in this test file. Companion commands run in them can start a
// detached broker that outlives the file, so the after() hook below stops each one when the file ends.
const createdWorkspaces = new Set();

// Set CODEX_PLUGIN_TEST_DEBUG=1 to print broker cleanup debug lines to stderr.
function debug(message) {
  if (process.env.CODEX_PLUGIN_TEST_DEBUG === "1") {
    process.stderr.write(`[test-helpers] ${message}\n`);
  }
}

async function stopCreatedWorkspaceBrokers() {
  debug(`enter stopCreatedWorkspaceBrokers workspaces=${createdWorkspaces.size}`);
  for (const cwd of createdWorkspaces) {
    const session = loadBrokerSession(cwd);
    if (!session) {
      debug(`no broker session for ${cwd}`);
      continue;
    }
    debug(`broker session for ${cwd}: pid=${session.pid ?? "none"} endpoint=${session.endpoint ?? "none"}`);
    if (session.endpoint) {
      await sendBrokerShutdown(session.endpoint);
      debug(`sent broker/shutdown to ${session.endpoint}`);
    }
    teardownBrokerSession({
      endpoint: session.endpoint ?? null,
      pidFile: session.pidFile ?? null,
      logFile: session.logFile ?? null,
      sessionDir: session.sessionDir ?? null,
      pid: session.pid ?? null,
      killProcess: (pid) => {
        const result = terminateProcessTree(pid);
        debug(`broker pid ${pid} ${result.delivered ? "sent SIGTERM" : "already gone"} (${result.method})`);
        return result;
      }
    });
    clearBrokerSession(cwd);
    debug(`teardown done for ${cwd}`);
  }
  debug("exit stopCreatedWorkspaceBrokers");
}

after(stopCreatedWorkspaceBrokers);

export function makeTempDir(prefix = "codex-plugin-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o755 });
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    shell: options.shell ?? (process.platform === "win32" && !path.isAbsolute(command)),
    windowsHide: true
  });
}

export function initGitRepo(cwd) {
  createdWorkspaces.add(cwd);
  debug(`registered workspace ${cwd}`);
  run("git", ["init", "-b", "main"], { cwd });
  run("git", ["config", "user.name", "Codex Plugin Tests"], { cwd });
  run("git", ["config", "user.email", "tests@example.com"], { cwd });
  run("git", ["config", "commit.gpgsign", "false"], { cwd });
  run("git", ["config", "tag.gpgsign", "false"], { cwd });
}
