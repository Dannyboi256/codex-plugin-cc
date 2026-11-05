import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTempDir } from "./helpers.mjs";
import { teardownBrokerSession } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";
import { terminateProcessTree } from "../plugins/codex/scripts/lib/process.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "tests", "broker-cleanup-fixture.mjs");
const INTENTIONAL_FAILURE = "broker-cleanup fixture: intentional failure after starting a broker";
const EXIT_WAIT_MS = 10000;
const POLL_INTERVAL_MS = 100;

// Set CODEX_PLUGIN_TEST_DEBUG=1 to print debug lines to stderr.
function debug(message) {
  if (process.env.CODEX_PLUGIN_TEST_DEBUG === "1") {
    process.stderr.write(`[broker-cleanup.test] ${message}\n`);
  }
}

function readCommand(pid) {
  const result = spawnSync("ps", ["-ww", "-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

// A pid counts as running only while it still shows the command the fixture recorded for it, so a
// recycled pid or a zombie is never reported as a survivor and never signalled.
function isRunning(proc) {
  const command = readCommand(proc.pid);
  if (proc.role === "broker") {
    return command.includes("app-server-broker.mjs serve") && command.includes(`--endpoint ${proc.endpoint}`);
  }
  return command !== "" && command === proc.command;
}

function readReport(reportPath) {
  if (!fs.existsSync(reportPath)) {
    return [];
  }
  return fs
    .readFileSync(reportPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function processesFrom(records) {
  const processes = [];
  for (const record of records) {
    if (!Number.isInteger(record.session?.pid)) {
      continue;
    }
    processes.push({ role: "broker", pid: record.session.pid, endpoint: record.session.endpoint, label: record.label });
    for (const child of record.children) {
      processes.push({ role: "codex app-server child", pid: child.pid, command: child.command, label: record.label });
    }
  }
  return processes;
}

function describeProcesses(processes) {
  return processes
    .map((proc) => `pid ${proc.pid} (${proc.role}, fixture test "${proc.label}": ${readCommand(proc.pid) || "exited"})`)
    .join("; ");
}

async function waitForExit(processes, timeoutMs) {
  debug(`enter waitForExit pids=${processes.map((proc) => proc.pid).join(",") || "none"} timeoutMs=${timeoutMs}`);
  const deadline = Date.now() + timeoutMs;
  let running = processes.filter(isRunning);
  while (running.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    running = running.filter(isRunning);
  }
  debug(`exit waitForExit running=${running.map((proc) => proc.pid).join(",") || "none"}`);
  return running;
}

function signal(proc, signalName) {
  try {
    process.kill(proc.pid, signalName);
    debug(`sent ${signalName} to pid ${proc.pid}`);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
    debug(`pid ${proc.pid} already gone before ${signalName}`);
  }
}

// Stops only the pids the fixture reported for its own workspaces, then removes their broker files.
async function stopReportedProcesses(records) {
  debug(`enter stopReportedProcesses records=${records.length}`);
  const processes = processesFrom(records);
  for (const proc of processes) {
    if (!isRunning(proc)) {
      debug(`pid ${proc.pid} (${proc.role}) not running`);
      continue;
    }
    if (proc.role === "broker") {
      debug(`broker pid ${proc.pid} still running; terminating its process tree`);
      terminateProcessTree(proc.pid);
    } else {
      signal(proc, "SIGTERM");
    }
  }
  let running = await waitForExit(processes, 5000);
  for (const proc of running) {
    signal(proc, "SIGKILL");
  }
  running = await waitForExit(running, 3000);

  for (const record of records) {
    if (record.session) {
      teardownBrokerSession({
        endpoint: record.session.endpoint ?? null,
        pidFile: record.session.pidFile ?? null,
        logFile: record.session.logFile ?? null,
        sessionDir: record.session.sessionDir ?? null
      });
    }
    fs.rmSync(path.join(record.stateDir, "broker.json"), { force: true });
  }
  debug(`exit stopReportedProcesses stillRunning=${running.map((proc) => proc.pid).join(",") || "none"}`);
  if (running.length > 0) {
    throw new Error(`Cleanup could not stop processes started by the fixture: ${describeProcesses(running)}`);
  }
}

test(
  "brokers started by a test file are stopped after that file finishes, even when one of its tests fails",
  {
    skip: process.platform === "win32" ? "identifies processes with ps" : false,
    timeout: 180000
  },
  async (t) => {
    const reportPath = path.join(makeTempDir(), "brokers.jsonl");
    t.after(async () => {
      await stopReportedProcesses(readReport(reportPath));
    });

    // The outer runner sets NODE_TEST_CONTEXT; a nested `node --test` that inherits it skips every file.
    const env = { ...process.env, CODEX_PLUGIN_BROKER_FIXTURE_REPORT: reportPath };
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ["--test", "--test-reporter=tap", FIXTURE], {
      cwd: ROOT,
      env,
      encoding: "utf8",
      timeout: 120000
    });
    const output = `${child.stdout}\n${child.stderr}`;
    debug(`nested fixture run exit=${child.status}; output:\n${output}`);

    assert.equal(child.error, undefined, `fixture run did not complete: ${child.error?.message}\n${output}`);
    assert.equal(child.status, 1, `fixture run should fail only on its intentional failure:\n${output}`);
    assert.match(child.stdout, /^# tests 3$/m, output);
    assert.match(child.stdout, /^# pass 2$/m, output);
    assert.match(child.stdout, /^# fail 1$/m, output);
    assert.ok(child.stdout.includes(INTENTIONAL_FAILURE), output);

    const records = readReport(reportPath);
    assert.deepEqual(
      records.map((record) => record.label),
      ["temp-repo", "nested-repo", "failing-test"],
      output
    );
    for (const record of records) {
      assert.ok(Number.isInteger(record.session?.pid), `fixture test "${record.label}" did not start a broker for ${record.repo}`);
      assert.ok(
        typeof record.session.endpoint === "string" && record.session.endpoint !== "",
        `fixture test "${record.label}" recorded no endpoint for broker pid ${record.session.pid}`
      );
      assert.ok(
        record.children.length > 0,
        `fixture test "${record.label}" found no codex app-server child of broker pid ${record.session.pid}`
      );
    }

    const survivors = await waitForExit(processesFrom(records), EXIT_WAIT_MS);
    assert.equal(
      survivors.length,
      0,
      `Processes started by the fixture test file are still running ${EXIT_WAIT_MS} ms after it finished: ${describeProcesses(survivors)}`
    );
  }
);
