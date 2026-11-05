// Child test file for tests/broker-cleanup.test.mjs, which runs it with `node --test`. Its name does not
// match tests/*.test.mjs, so the suite never runs it directly.
//
// Each test starts a real broker with the same helpers runtime.test.mjs uses (makeTempDir, initGitRepo,
// run, installFakeCodex, buildEnv), so broker cleanup hooked into those helpers runs here too. Each test
// appends what it started to the JSON-lines report named by CODEX_PLUGIN_BROKER_FIXTURE_REPORT. The
// report is written from inside this process, before any after() cleanup can delete broker.json.
//
// Set CODEX_PLUGIN_TEST_DEBUG=1 to print debug lines to stderr.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";
import { loadBrokerSession } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";
import { resolveStateDir } from "../plugins/codex/scripts/lib/state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "plugins", "codex", "scripts", "codex-companion.mjs");
const REPORT_PATH = process.env.CODEX_PLUGIN_BROKER_FIXTURE_REPORT;
const INTENTIONAL_FAILURE = "broker-cleanup fixture: intentional failure after starting a broker";

if (!REPORT_PATH) {
  throw new Error("CODEX_PLUGIN_BROKER_FIXTURE_REPORT must name the report file.");
}

function debug(message) {
  if (process.env.CODEX_PLUGIN_TEST_DEBUG === "1") {
    process.stderr.write(`[broker-cleanup-fixture] ${message}\n`);
  }
}

function listChildProcesses(parentPid) {
  const result = spawnSync("ps", ["-ww", "-axo", "pid=,ppid=,command="], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const children = [];
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (match && Number(match[2]) === parentPid) {
      children.push({ pid: Number(match[1]), command: match[3] });
    }
  }
  return children;
}

function startBrokerWithReview(label, repo) {
  debug(`enter startBrokerWithReview label=${label} repo=${repo}`);
  const binDir = makeTempDir();
  installFakeCodex(binDir);
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "hello again\n");

  const review = run("node", [SCRIPT, "review"], {
    cwd: repo,
    env: buildEnv(binDir)
  });
  const session = loadBrokerSession(repo);
  const children = Number.isInteger(session?.pid) ? listChildProcesses(session.pid) : [];
  debug(`review exit=${review.status} brokerPid=${session?.pid ?? "none"} childPids=${children.map((child) => child.pid).join(",") || "none"}`);
  fs.appendFileSync(
    REPORT_PATH,
    `${JSON.stringify({ label, repo, stateDir: resolveStateDir(repo), reviewStatus: review.status, session, children })}\n`,
    "utf8"
  );

  assert.equal(review.status, 0, review.stderr);
  assert.ok(session, `review did not record a broker for ${repo}`);
  debug(`exit startBrokerWithReview label=${label}`);
}

test("starts a broker in a temp git repo", () => {
  startBrokerWithReview("temp-repo", makeTempDir());
});

test("starts a broker in a git repo nested inside a temp dir", () => {
  const home = makeTempDir();
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo);
  startBrokerWithReview("nested-repo", repo);
});

test("starts a broker and then fails", () => {
  startBrokerWithReview("failing-test", makeTempDir());
  throw new Error(INTENTIONAL_FAILURE);
});
