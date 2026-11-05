import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTempDir } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Inside a Claude Code session, the plugin's SessionStart hook exports CLAUDE_PLUGIN_DATA,
// CODEX_COMPANION_SESSION_ID and CODEX_COMPANION_TRANSCRIPT_PATH into every shell. The plugin's hooks also
// read CLAUDE_ENV_FILE and CLAUDE_PROJECT_DIR, which Claude Code sets for hook processes. A test run started
// with any of these set must behave as it does with all of them unset.
//
// The nested run below covers each way the tests reach those variables:
// - in-process state resolution in a file that imports only helpers.mjs (state.test.mjs);
// - in-process state and broker.json writes in runtime.test.mjs (status/result, setup --cwd);
// - companion children that inherit process.env implicitly (status/result run without env);
// - children spawned with an explicit `...process.env` spread (session end hook);
// - children spawned with buildEnv, plus the broker they start and the helpers.mjs after() cleanup (review);
// - tests that set one of the variables themselves (session start hook, transfer, CLAUDE_PLUGIN_DATA case).
const NESTED_TESTS = [
  ["tests/state.test.mjs", "resolveStateDir uses a temp-backed per-workspace directory"],
  ["tests/state.test.mjs", "resolveStateDir uses CLAUDE_PLUGIN_DATA when it is provided"],
  ["tests/state.test.mjs", "saveState prunes dropped job artifacts when indexed jobs exceed the cap"],
  ["tests/runtime.test.mjs", "status shows phases, hints, and the latest finished job"],
  ["tests/runtime.test.mjs", "status preserves adversarial review kind labels"],
  ["tests/runtime.test.mjs", "result returns the stored output for the latest finished job by default"],
  ["tests/runtime.test.mjs", "setup and status honor --cwd when reading shared session runtime"],
  ["tests/runtime.test.mjs", "session end fully cleans up jobs for the ending session"],
  ["tests/runtime.test.mjs", "review renders a no-findings result from app-server review/start"],
  ["tests/runtime.test.mjs", "session start hook exports the Claude session id, transcript path, and plugin data dir"],
  ["tests/runtime.test.mjs", "transfer delegates the current Claude session directly to native import"]
];
const MAX_LISTED_CHANGES = 40;

// Set CODEX_PLUGIN_TEST_DEBUG=1 to print debug lines to stderr.
function debug(message) {
  if (process.env.CODEX_PLUGIN_TEST_DEBUG === "1") {
    process.stderr.write(`[session-env-isolation.test] ${message}\n`);
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Maps each path under root (except the skipped top-level entries) to "dir" or the file's contents.
function snapshot(root, skip) {
  const entries = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(root, fullPath);
      if (skip.includes(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        entries.set(`${relativePath}${path.sep}`, "dir");
        walk(fullPath);
      } else {
        entries.set(relativePath, fs.readFileSync(fullPath, "utf8"));
      }
    }
  };
  walk(root);
  return entries;
}

function describeChanges(before, after) {
  const changes = [];
  for (const [entryPath, value] of after) {
    if (!before.has(entryPath)) {
      changes.push(`created ${entryPath}`);
    } else if (before.get(entryPath) !== value) {
      changes.push(`modified ${entryPath}`);
    }
  }
  for (const entryPath of before.keys()) {
    if (!after.has(entryPath)) {
      changes.push(`deleted ${entryPath}`);
    }
  }
  return changes.sort();
}

test(
  "tests ignore the Claude session and plugin variables inherited from the environment",
  { timeout: 120000 },
  () => {
    debug("enter inherited-variable isolation test");
    // The nested run gets its own TMPDIR inside sentinelRoot, so the sentinel plugin data dir sits outside
    // the nested os.tmpdir(), as the real plugin data dir does.
    const sentinelRoot = makeTempDir("cpenv-");
    const nestedTmpDir = path.join(sentinelRoot, "tmp");
    const pluginDataDir = path.join(sentinelRoot, "plugin-data");
    const projectDir = path.join(sentinelRoot, "project");
    const envFile = path.join(sentinelRoot, "claude-env.sh");
    const transcriptPath = path.join(sentinelRoot, "transcript", "sentinel-session.jsonl");
    for (const dir of [nestedTmpDir, pluginDataDir, projectDir, path.dirname(transcriptPath)]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(envFile, "", "utf8");
    fs.writeFileSync(transcriptPath, `${JSON.stringify({ type: "user", message: { role: "user", content: "sentinel" } })}\n`, "utf8");
    const before = snapshot(sentinelRoot, ["tmp"]);

    const sentinels = {
      CLAUDE_PLUGIN_DATA: pluginDataDir,
      CODEX_COMPANION_SESSION_ID: "sess-sentinel-inherited",
      CODEX_COMPANION_TRANSCRIPT_PATH: transcriptPath,
      CLAUDE_ENV_FILE: envFile,
      CLAUDE_PROJECT_DIR: projectDir
    };
    debug(`sentinels ${JSON.stringify(sentinels)} TMPDIR=${nestedTmpDir}`);

    // The outer runner sets NODE_TEST_CONTEXT; a nested `node --test` that inherits it skips every file.
    const env = { ...process.env, ...sentinels, TMPDIR: nestedTmpDir };
    delete env.NODE_TEST_CONTEXT;
    const files = [...new Set(NESTED_TESTS.map(([file]) => file))];
    const args = [
      "--test",
      "--test-reporter=tap",
      ...NESTED_TESTS.map(([, name]) => `--test-name-pattern=^${escapeRegExp(name)}$`),
      ...files
    ];
    const child = spawnSync(process.execPath, args, {
      cwd: ROOT,
      env,
      encoding: "utf8",
      timeout: 90000
    });
    const output = `${child.stdout}\n${child.stderr}`;
    debug(`nested run exit=${child.status} signal=${child.signal}; output:\n${output}`);

    assert.equal(child.error, undefined, `nested run did not complete: ${child.error?.message}\n${output}`);

    const reported = [...child.stdout.matchAll(/^(not ok|ok) \d+ - (.*)$/gm)].map((match) => ({
      ok: match[1] === "ok",
      name: match[2]
    }));
    const missing = NESTED_TESTS.map(([, name]) => name).filter((name) => !reported.some((entry) => entry.name === name));
    const failing = reported.filter((entry) => !entry.ok).map((entry) => entry.name);
    debug(`reported=${reported.length} missing=${JSON.stringify(missing)} failing=${JSON.stringify(failing)}`);

    const changes = describeChanges(before, snapshot(sentinelRoot, ["tmp"]));
    debug(`sentinel changes=${changes.length}${changes.length > 0 ? `:\n${changes.join("\n")}` : ""}`);

    assert.deepEqual(missing, [], `nested run did not run these selected tests (renamed or removed?):\n${missing.join("\n")}\n${output}`);
    assert.match(child.stdout, new RegExp(`^# tests ${NESTED_TESTS.length}$`, "m"), output);

    const problems = [];
    if (failing.length > 0) {
      problems.push(`These tests fail when the session and plugin variables are inherited:\n${failing.join("\n")}`);
    } else if (child.status !== 0) {
      problems.push(`The nested run exited ${child.status} without a failing test.`);
    }
    if (changes.length > 0) {
      const listed = changes.slice(0, MAX_LISTED_CHANGES);
      if (changes.length > listed.length) {
        listed.push(`... and ${changes.length - listed.length} more`);
      }
      problems.push(
        `The nested run made ${changes.length} changes to the sentinel session and plugin locations under ${sentinelRoot}:\n${listed.join("\n")}`
      );
    }
    debug(`exit inherited-variable isolation test problems=${problems.length}`);
    assert.equal(problems.length, 0, `${problems.join("\n\n")}\n\nNested run output:\n${output}`);
  }
);
