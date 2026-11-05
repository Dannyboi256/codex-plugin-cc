import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "codex");
const PROMPTING_SKILL_DIR = path.join(PLUGIN_ROOT, "skills", "codex-prompting");
// Built from parts so this file does not itself contain the retired skill name
// that the repository-wide scan below forbids.
const RETIRED_PROMPTING_SKILL = ["gpt", "5", "4", "prompting"].join("-");
// Model and model-version names that must not appear in the model-neutral
// prompting skill: any GPT name or version (GPT-5.4, gpt-5.4-mini, gpt-6-astra,
// GPT-6.1), o-series, codex-mini and codex-1 names, and bare model or family
// names as words (Sol, Luna, Terra, Astra, Sonnet, Opus, Haiku, spark).
const MODEL_NAME_PATTERN = /gpt|\bo[1-9]\b|\bcodex-(?:mini|1)\b|\b(?:sol|luna|terra|astra|sonnet|opus|haiku|spark)\b/i;

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

function listFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function parseFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "expected a YAML frontmatter block delimited by --- lines");
  const fields = {};
  let currentList = null;
  for (const line of match[1].split("\n")) {
    const listItem = line.match(/^\s+-\s+(.+?)\s*$/);
    if (listItem && currentList) {
      currentList.push(listItem[1]);
      continue;
    }
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (keyValue) {
      currentList = keyValue[2] === "" ? [] : null;
      fields[keyValue[1]] = currentList ?? keyValue[2];
    }
  }
  return { fields, body: source.slice(match[0].length) };
}

function relativeMarkdownLinks(source) {
  const prose = source.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const targets = [
    ...Array.from(prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g), (match) => match[1]),
    ...Array.from(prose.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm), (match) => match[1])
  ];
  return targets.filter((target) => !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target));
}

function resolveMarkdownLink(fromFile, target) {
  return path.resolve(path.dirname(fromFile), decodeURIComponent(target.split("#")[0]));
}

function lineMatchingAll(source, patterns) {
  return source.split("\n").find((line) => patterns.every((pattern) => pattern.test(line)));
}

// Text from the one `## ` heading matching headingPattern up to the next `## ` heading.
function markdownSection(source, headingPattern) {
  const lines = source.split("\n");
  const starts = lines.flatMap((line, index) => (headingPattern.test(line) ? [index] : []));
  assert.equal(starts.length, 1, `expected exactly one heading matching ${headingPattern}`);
  const end = lines.findIndex((line, index) => index > starts[0] && /^## /.test(line));
  return lines.slice(starts[0], end === -1 ? lines.length : end).join("\n");
}

function xmlBlock(source, tag) {
  const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  assert.ok(match, `expected a <${tag}> block`);
  return match[1].trim();
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s/;

// Indexes of the list items that follow lines[index]. Blank lines before the list and
// between items are skipped, since a loose Markdown list continues past them.
function listItemIndexesAfter(lines, index) {
  const nextNonBlank = (from) => {
    let cursor = from;
    while (cursor < lines.length && lines[cursor].trim() === "") {
      cursor += 1;
    }
    return cursor;
  };
  const indexes = [];
  for (let cursor = nextNonBlank(index + 1); cursor < lines.length && LIST_ITEM.test(lines[cursor]); ) {
    indexes.push(cursor);
    cursor = nextNonBlank(cursor + 1);
  }
  return indexes;
}

test("review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Codex's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /review "\$ARGUMENTS"/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/codex-companion\.mjs" review "\$ARGUMENTS"`/);
  assert.match(source, /description:\s*"Codex review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(source, /Treat untracked files or directories as reviewable work/i);
  assert.match(source, /Recommend waiting only when the review is clearly tiny, roughly 1-2 files total/i);
  assert.match(source, /In every other case, including unclear size, recommend background/i);
  assert.match(source, /The companion script parses `--wait` and `--background`/i);
  assert.match(source, /Claude Code's `Bash\(..., run_in_background: true\)` is what actually detaches the run/i);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /does not support staged-only review, unstaged-only review, or extra focus text/i);
});

test("adversarial review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/adversarial-review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Codex's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /adversarial-review "\$ARGUMENTS"/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\] \[focus \.\.\.\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/codex-companion\.mjs" adversarial-review "\$ARGUMENTS"`/);
  assert.match(source, /description:\s*"Codex adversarial review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(source, /Treat untracked files or directories as reviewable work/i);
  assert.match(source, /Recommend waiting only when the scoped review is clearly tiny, roughly 1-2 files total/i);
  assert.match(source, /In every other case, including unclear size, recommend background/i);
  assert.match(source, /The companion script parses `--wait` and `--background`/i);
  assert.match(source, /Claude Code's `Bash\(..., run_in_background: true\)` is what actually detaches the run/i);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /uses the same review target selection as `\/codex:review`/i);
  assert.match(source, /supports working-tree review, branch review, and `--base <ref>`/i);
  assert.match(source, /does not support `--scope staged` or `--scope unstaged`/i);
  assert.match(source, /can still take extra focus text after the flags/i);
});

test("continue is not exposed as a user-facing command", () => {
  const commandFiles = fs.readdirSync(path.join(PLUGIN_ROOT, "commands")).sort();
  assert.deepEqual(commandFiles, [
    "adversarial-review.md",
    "cancel.md",
    "rescue.md",
    "result.md",
    "review.md",
    "setup.md",
    "status.md",
    "transfer.md"
  ]);
});

test("rescue command absorbs continue semantics", () => {
  const rescue = read("commands/rescue.md");
  const agent = read("agents/codex-rescue.md");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const runtimeSkill = read("skills/codex-cli-runtime/SKILL.md");

  assert.match(rescue, /The final user-visible response must be Codex's output verbatim/i);
  assert.match(rescue, /allowed-tools:\s*Bash\(node:\*\),\s*AskUserQuestion,\s*Agent/);
  // Regression for #234: `Skill(codex:rescue)` from the main agent recursed
  // because rescue.md named the routing with ambiguous prose ("Route this
  // request to the `codex:codex-rescue` subagent") while running under
  // `context: fork` — forked general-purpose subagents do not expose the
  // `Agent` tool, so the fork fell back to `Skill` and re-entered this
  // command. Pin the explicit transport and the inline (no-fork) execution.
  assert.match(rescue, /subagent_type: "codex:codex-rescue"/);
  assert.match(rescue, /do not call `Skill\(codex:codex-rescue\)`/i);
  assert.doesNotMatch(rescue, /^context:\s*fork\b/m);
  assert.match(rescue, /--background\|--wait/);
  assert.match(rescue, /--resume\|--fresh/);
  assert.match(rescue, /--model <model\|spark>/);
  assert.match(rescue, /--effort <none\|minimal\|low\|medium\|high\|xhigh>/);
  assert.match(rescue, /task-resume-candidate --json/);
  assert.match(rescue, /AskUserQuestion/);
  assert.match(rescue, /Continue current Codex thread/);
  assert.match(rescue, /Start a new Codex thread/);
  assert.match(rescue, /run the `codex:codex-rescue` subagent in the background/i);
  assert.match(rescue, /default to foreground/i);
  assert.match(rescue, /Do not forward them to `task`/i);
  assert.match(rescue, /`--model` and `--effort` are runtime-selection flags/i);
  assert.match(rescue, /Leave `--effort` unset unless the user explicitly asks for a specific reasoning effort/i);
  assert.match(rescue, /If they ask for `spark`, map it to `gpt-5\.3-codex-spark`/i);
  assert.match(rescue, /If the request includes `--resume`, do not ask whether to continue/i);
  assert.match(rescue, /If the request includes `--fresh`, do not ask whether to continue/i);
  assert.match(rescue, /If the user chooses continue, add `--resume`/i);
  assert.match(rescue, /If the user chooses a new thread, add `--fresh`/i);
  assert.match(rescue, /thin forwarder only/i);
  assert.match(rescue, /Return the Codex companion stdout verbatim to the user/i);
  assert.match(rescue, /Do not paraphrase, summarize, rewrite, or add commentary before or after it/i);
  assert.match(rescue, /return that command's stdout as-is/i);
  assert.match(rescue, /Leave `--resume` and `--fresh` in the forwarded request/i);
  assert.match(agent, /--resume/);
  assert.match(agent, /--fresh/);
  assert.match(agent, /thin forwarding wrapper/i);
  assert.match(agent, /prefer foreground for a small, clearly bounded rescue request/i);
  assert.match(agent, /If the user did not explicitly choose `--background` or `--wait` and the task looks complicated, open-ended, multi-step, or likely to keep Codex running for a long time, prefer background execution/i);
  assert.match(agent, /Use exactly one `Bash` call/i);
  assert.match(agent, /Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own/i);
  assert.match(agent, /Do not call `review`, `adversarial-review`, `status`, `result`, or `cancel`/i);
  assert.match(agent, /Leave `--effort` unset unless the user explicitly requests a specific reasoning effort/i);
  assert.match(agent, /Leave model unset by default/i);
  assert.match(agent, /If the user asks for `spark`, map that to `--model gpt-5\.3-codex-spark`/i);
  assert.match(agent, /If the user asks for a concrete model name such as `gpt-5\.4-mini`, pass it through with `--model`/i);
  assert.match(agent, /Return the stdout of the `codex-companion` command exactly as-is/i);
  assert.match(agent, /If the Bash call fails or Codex cannot be invoked, return nothing/i);
  assert.match(agent, /codex-prompting/);
  assert.match(agent, /only to tighten the user's request into a better Codex prompt/i);
  assert.match(agent, /Do not use that skill to inspect the repository, reason through the problem yourself, draft a solution, or do any independent work/i);
  assert.match(runtimeSkill, /only job is to invoke `task` once and return that stdout unchanged/i);
  assert.match(runtimeSkill, /Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel`/i);
  assert.match(runtimeSkill, /use the `codex-prompting` skill to rewrite the user's request into a tighter Codex prompt/i);
  assert.match(runtimeSkill, /That prompt drafting is the only Claude-side work allowed/i);
  assert.match(runtimeSkill, /Leave `--effort` unset unless the user explicitly requests a specific effort/i);
  assert.match(runtimeSkill, /Leave model unset by default/i);
  assert.match(runtimeSkill, /Map `spark` to `--model gpt-5\.3-codex-spark`/i);
  assert.match(runtimeSkill, /If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only/i);
  assert.match(runtimeSkill, /Strip it before calling `task`/i);
  assert.match(runtimeSkill, /`--effort`: accepted values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`/i);
  assert.match(runtimeSkill, /Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own/i);
  assert.match(runtimeSkill, /If the Bash call fails or Codex cannot be invoked, return nothing/i);
  assert.match(readme, /`codex:codex-rescue` subagent/i);
  assert.match(readme, /if you do not pass `--model` or `--effort`, Codex chooses its own defaults/i);
  assert.match(readme, /--model gpt-5\.4-mini --effort medium/i);
  assert.match(readme, /`spark`, the plugin maps that to `gpt-5\.3-codex-spark`/i);
  assert.match(readme, /continue a previous Codex task/i);
  assert.match(readme, /### `\/codex:setup`/);
  assert.match(readme, /### `\/codex:review`/);
  assert.match(readme, /### `\/codex:adversarial-review`/);
  assert.match(readme, /uses the same review target selection as `\/codex:review`/i);
  assert.match(readme, /--base main challenge whether this was the right caching and retry design/);
  assert.match(readme, /### `\/codex:rescue`/);
  assert.match(readme, /### `\/codex:transfer`/);
  assert.match(readme, /### `\/codex:status`/);
  assert.match(readme, /### `\/codex:result`/);
  assert.match(readme, /### `\/codex:cancel`/);
});

test("transfer, result, and cancel commands are exposed as deterministic runtime entrypoints", () => {
  const transfer = read("commands/transfer.md");
  const result = read("commands/result.md");
  const cancel = read("commands/cancel.md");
  const resultHandling = read("skills/codex-result-handling/SKILL.md");

  assert.match(transfer, /disable-model-invocation:\s*true/);
  assert.match(transfer, /codex-companion\.mjs" transfer "\$ARGUMENTS"/);
  assert.match(transfer, /codex resume <session-id>/);
  assert.match(result, /disable-model-invocation:\s*true/);
  assert.match(result, /codex-companion\.mjs" result "\$ARGUMENTS"/);
  assert.match(cancel, /disable-model-invocation:\s*true/);
  assert.match(cancel, /codex-companion\.mjs" cancel "\$ARGUMENTS"/);
  assert.match(resultHandling, /do not turn a failed or incomplete Codex run into a Claude-side implementation attempt/i);
  assert.match(resultHandling, /if Codex was never successfully invoked, do not generate a substitute answer at all/i);
});

test("internal docs use task terminology for rescue runs", () => {
  const runtimeSkill = read("skills/codex-cli-runtime/SKILL.md");
  const promptingSkill = read("skills/codex-prompting/SKILL.md");
  const promptRecipes = read("skills/codex-prompting/references/codex-prompt-recipes.md");

  assert.match(runtimeSkill, /codex-companion\.mjs" task "<raw arguments>"/);
  assert.match(runtimeSkill, /Use `task` for every rescue request/i);
  assert.match(runtimeSkill, /task --resume-last/i);
  assert.ok(
    lineMatchingAll(promptingSkill, [/`task`/, /diagnosis/i, /implementation/i]),
    "codex-prompting SKILL.md should say on one line that `task` is used for diagnosis and implementation work"
  );
  assert.ok(
    lineMatchingAll(promptingSkill, [/`task --resume-last`/, /follow[- ]?up/i, /only the delta/i]),
    "codex-prompting SKILL.md should say on one line that `task --resume-last` follow-ups send only the delta instruction"
  );
  assert.ok(
    lineMatchingAll(promptingSkill, [/`review`/, /`adversarial-review`/, /local (?:git )?changes/i]),
    "codex-prompting SKILL.md should say on one line that `review` / `adversarial-review` handle local git changes"
  );
  assert.match(promptRecipes, /Codex task prompts/i);
  assert.match(promptRecipes, /Use these as starting templates for Codex task prompts/i);
  assert.match(promptRecipes, /## Diagnosis/);
  assert.match(promptRecipes, /## Narrow Fix/);
});

test("prompting guidance ships as the codex-prompting skill with no retired alias", () => {
  assert.equal(
    fs.existsSync(path.join(PLUGIN_ROOT, "skills", RETIRED_PROMPTING_SKILL)),
    false,
    `skills/${RETIRED_PROMPTING_SKILL} should be removed, not kept as an alias or stub`
  );
  // Every entry (directories, files and symlinks) so an alias under any name is
  // caught; dot-entries such as macOS .DS_Store are ignored.
  const skillEntries = fs
    .readdirSync(path.join(PLUGIN_ROOT, "skills"))
    .filter((name) => !name.startsWith("."))
    .sort();
  assert.deepEqual(skillEntries, ["codex-cli-runtime", "codex-prompting", "codex-result-handling"]);

  const { fields } = parseFrontmatter(read("skills/codex-prompting/SKILL.md"));
  assert.equal(fields.name, "codex-prompting");
  assert.equal(fields["user-invocable"], "false");
});

test("rescue agent and runtime skill load codex-prompting by name", () => {
  const agent = parseFrontmatter(read("agents/codex-rescue.md"));
  const runtimeSkill = read("skills/codex-cli-runtime/SKILL.md");

  assert.deepEqual(agent.fields.skills, ["codex-cli-runtime", "codex-prompting"]);
  for (const skillName of agent.fields.skills) {
    const skill = parseFrontmatter(read(`skills/${skillName}/SKILL.md`));
    assert.equal(skill.fields.name, skillName, `skills/${skillName}/SKILL.md frontmatter name`);
  }
  assert.match(
    agent.body,
    /- You may use the `codex-prompting` skill only to tighten the user's request into a better Codex prompt before forwarding it\./
  );
  assert.match(
    runtimeSkill,
    /- You may use the `codex-prompting` skill to rewrite the user's request into a tighter Codex prompt before the single `task` call\./
  );
});

test("rescue agent text is unchanged apart from the prompting skill name", () => {
  // Upstream db52e28 agents/codex-rescue.md with only the prompting skill name replaced.
  const expected = [
    "---",
    "name: codex-rescue",
    "description: Proactively use when Claude Code is stuck, wants a second implementation or diagnosis pass, needs a deeper root-cause investigation, or should hand a substantial coding task to Codex through the shared runtime",
    "model: sonnet",
    "tools: Bash",
    "skills:",
    "  - codex-cli-runtime",
    "  - codex-prompting",
    "---",
    "",
    "You are a thin forwarding wrapper around the Codex companion task runtime.",
    "",
    "Your only job is to forward the user's rescue request to the Codex companion script. Do not do anything else.",
    "",
    "Selection guidance:",
    "",
    "- Do not wait for the user to explicitly ask for Codex. Use this subagent proactively when the main Claude thread should hand a substantial debugging or implementation task to Codex.",
    "- Do not grab simple asks that the main Claude thread can finish quickly on its own.",
    "",
    "Forwarding rules:",
    "",
    "- Use exactly one `Bash` call to invoke `node \"${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs\" task ...`.",
    "- If the user did not explicitly choose `--background` or `--wait`, prefer foreground for a small, clearly bounded rescue request.",
    "- If the user did not explicitly choose `--background` or `--wait` and the task looks complicated, open-ended, multi-step, or likely to keep Codex running for a long time, prefer background execution.",
    "- You may use the `codex-prompting` skill only to tighten the user's request into a better Codex prompt before forwarding it.",
    "- Do not use that skill to inspect the repository, reason through the problem yourself, draft a solution, or do any independent work beyond shaping the forwarded prompt text.",
    "- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own.",
    "- Do not call `review`, `adversarial-review`, `status`, `result`, or `cancel`. This subagent only forwards to `task`.",
    "- Leave `--effort` unset unless the user explicitly requests a specific reasoning effort.",
    "- Leave model unset by default. Only add `--model` when the user explicitly asks for a specific model.",
    "- If the user asks for `spark`, map that to `--model gpt-5.3-codex-spark`.",
    "- If the user asks for a concrete model name such as `gpt-5.4-mini`, pass it through with `--model`.",
    "- Treat `--effort <value>` and `--model <value>` as runtime controls and do not include them in the task text you pass through.",
    "- Default to a write-capable Codex run by adding `--write` unless the user explicitly asks for read-only behavior or only wants review, diagnosis, or research without edits.",
    "- Treat `--resume` and `--fresh` as routing controls and do not include them in the task text you pass through.",
    "- `--resume` means add `--resume-last`.",
    "- `--fresh` means do not add `--resume-last`.",
    "- If the user is clearly asking to continue prior Codex work in this repository, such as \"continue\", \"keep going\", \"resume\", \"apply the top fix\", or \"dig deeper\", add `--resume-last` unless `--fresh` is present.",
    "- Otherwise forward the task as a fresh `task` run.",
    "- Preserve the user's task text as-is apart from stripping routing flags.",
    "- Return the stdout of the `codex-companion` command exactly as-is.",
    "- If the Bash call fails or Codex cannot be invoked, return nothing.",
    "",
    "Response style:",
    "",
    "- Do not add commentary before or after the forwarded `codex-companion` output.",
    ""
  ];
  assert.deepEqual(read("agents/codex-rescue.md").split("\n"), expected);
});

test("runtime skill text is unchanged apart from the prompting skill name", () => {
  // Upstream db52e28 skills/codex-cli-runtime/SKILL.md with only the prompting skill name replaced.
  const expected = [
    "---",
    "name: codex-cli-runtime",
    "description: Internal helper contract for calling the codex-companion runtime from Claude Code",
    "user-invocable: false",
    "---",
    "",
    "# Codex Runtime",
    "",
    "Use this skill only inside the `codex:codex-rescue` subagent.",
    "",
    "Primary helper:",
    "- `node \"${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs\" task \"<raw arguments>\"`",
    "",
    "Execution rules:",
    "- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.",
    "- Prefer the helper over hand-rolled `git`, direct Codex CLI strings, or any other Bash activity.",
    "- Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel` from `codex:codex-rescue`.",
    "- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.",
    "- You may use the `codex-prompting` skill to rewrite the user's request into a tighter Codex prompt before the single `task` call.",
    "- That prompt drafting is the only Claude-side work allowed. Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.",
    "- Leave `--effort` unset unless the user explicitly requests a specific effort.",
    "- Leave model unset by default. Add `--model` only when the user explicitly asks for one.",
    "- Map `spark` to `--model gpt-5.3-codex-spark`.",
    "- Default to a write-capable Codex run by adding `--write` unless the user explicitly asks for read-only behavior or only wants review, diagnosis, or research without edits.",
    "",
    "Command selection:",
    "- Use exactly one `task` invocation per rescue handoff.",
    "- If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only. Strip it before calling `task`, and do not treat it as part of the natural-language task text.",
    "- If the forwarded request includes `--model`, normalize `spark` to `gpt-5.3-codex-spark` and pass it through to `task`.",
    "- If the forwarded request includes `--effort`, pass it through to `task`.",
    "- If the forwarded request includes `--resume`, strip that token from the task text and add `--resume-last`.",
    "- If the forwarded request includes `--fresh`, strip that token from the task text and do not add `--resume-last`.",
    "- `--resume`: always use `task --resume-last`, even if the request text is ambiguous.",
    "- `--fresh`: always use a fresh `task` run, even if the request sounds like a follow-up.",
    "- `--effort`: accepted values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`.",
    "- `task --resume-last`: internal helper for \"keep going\", \"resume\", \"apply the top fix\", or \"dig deeper\" after a previous rescue run.",
    "",
    "Safety rules:",
    "- Default to write-capable Codex work in `codex:codex-rescue` unless the user explicitly asks for read-only behavior.",
    "- Preserve the user's task text as-is apart from stripping routing flags.",
    "- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own.",
    "- Return the stdout of the `task` command exactly as-is.",
    "- If the Bash call fails or Codex cannot be invoked, return nothing.",
    ""
  ];
  assert.deepEqual(read("skills/codex-cli-runtime/SKILL.md").split("\n"), expected);
});

test("no repository file mentions the retired prompting skill name", () => {
  const offenders = listFiles(ROOT)
    .filter((file) => fs.readFileSync(file, "utf8").includes(RETIRED_PROMPTING_SKILL))
    .map((file) => path.relative(ROOT, file));
  assert.deepEqual(offenders, []);
});

test("codex-prompting skill files do not name a model or model version", () => {
  const files = listFiles(PROMPTING_SKILL_DIR);
  assert.ok(files.includes(path.join(PROMPTING_SKILL_DIR, "SKILL.md")), "codex-prompting/SKILL.md should exist");

  const hits = [];
  for (const file of files) {
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        const match = line.match(MODEL_NAME_PATTERN);
        if (match) {
          hits.push(`${path.relative(PLUGIN_ROOT, file)}:${index + 1}: ${match[0]}`);
        }
      });
  }
  assert.deepEqual(hits, []);
});

test("codex-prompting relative Markdown links resolve to existing files", () => {
  const skillFile = path.join(PROMPTING_SKILL_DIR, "SKILL.md");
  assert.ok(
    relativeMarkdownLinks(fs.readFileSync(skillFile, "utf8")).length > 0,
    "codex-prompting SKILL.md should link to its reference files"
  );

  const broken = [];
  for (const file of listFiles(PROMPTING_SKILL_DIR).filter((candidate) => candidate.endsWith(".md"))) {
    for (const target of relativeMarkdownLinks(fs.readFileSync(file, "utf8"))) {
      const resolved = resolveMarkdownLink(file, target);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        broken.push(`${path.relative(PLUGIN_ROOT, file)} -> ${target}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test("codex-prompting SKILL.md routes to every reference file", () => {
  const skillFile = path.join(PROMPTING_SKILL_DIR, "SKILL.md");
  const linked = new Set(
    relativeMarkdownLinks(fs.readFileSync(skillFile, "utf8")).map((target) => resolveMarkdownLink(skillFile, target))
  );
  const referenceFiles = listFiles(path.join(PROMPTING_SKILL_DIR, "references"));
  assert.ok(referenceFiles.length > 0, "codex-prompting should keep its reference files");
  const unlinked = referenceFiles.filter((file) => !linked.has(file)).map((file) => path.relative(PLUGIN_ROOT, file));
  assert.deepEqual(unlinked, []);
});

// Follow-through is presented as near-default, in agreement with prompt-blocks.md
// ("Most prompts need ... follow_through", "any prompt where Codex might otherwise stop to ask").
const NEAR_DEFAULT_PATTERN =
  /\b(?:nearly|almost|virtually)\s+(?:every|all|always)\b|\bmost (?:prompts|runs|tasks)\b|\busually\b|\bby default\b|\b(?:any|every) prompt where\b/i;

test("codex-prompting SKILL.md puts follow-through on its own line after the four parts", () => {
  const lines = read("skills/codex-prompting/SKILL.md").split("\n");
  const fourPartsIndex = lines.findIndex((line) => /\bfour parts\b/i.test(line));
  assert.notEqual(fourPartsIndex, -1, "SKILL.md should keep the four-part framing");
  const fourParts = listItemIndexesAfter(lines, fourPartsIndex);
  assert.deepEqual(
    fourParts.map((index) => lines[index].match(/^\s*(?:[-*+]|\d+\.)\s+(?:\*\*)?([^:*]+?)(?:\*\*)?:/)?.[1]),
    ["Goal", "Context", "Constraints", "Done when"],
    "the four-part list should hold exactly Goal, Context, Constraints, and Done when"
  );
  const fourPartsEnd = fourParts.at(-1);
  const addOnlyIndex = lines.findIndex((line) => /add only what the task needs/i.test(line));
  assert.ok(
    addOnlyIndex > fourPartsEnd,
    "the 'Add only what the task needs' list should come after the four-part list"
  );

  const between = lines.slice(fourPartsEnd + 1, addOnlyIndex);
  assert.ok(
    between.some((line) => /follow[-_ ]?through/i.test(line)),
    "SKILL.md should put follow-through on its own line after the four-part list and before 'Add only what the task needs'"
  );
  assert.equal(
    between[0].trim(),
    "",
    "a blank line should separate follow-through from the Done when item, so it is not a continuation of that item"
  );
  assert.deepEqual(
    between.filter((line) => LIST_ITEM.test(line)),
    [],
    "follow-through should be a line or short paragraph, not a list item"
  );
  assert.deepEqual(
    between.filter((line) => /^\s+\S/.test(line)),
    [],
    "follow-through should start at column 0, so it is not nested under the Done when item"
  );
  const paragraph = between.join(" ");
  assert.match(paragraph, NEAR_DEFAULT_PATTERN, "follow-through should read as belonging in nearly every prompt");
  assert.match(paragraph, /reasonable assumptions/i, "follow-through should still say to make reasonable assumptions");
  assert.match(paragraph, /\bstop\w* to ask\b|\bask\w* (?:a )?questions?\b/i, "follow-through should still say not to stop to ask");
  assert.match(paragraph, /\bwithout (?:approval|asking)\b/i, "follow-through should still say what may proceed without approval");
  assert.match(paragraph, /destructive|irreversible/i, "follow-through should still reserve stopping for destructive or irreversible actions");
});

test("codex-prompting SKILL.md no longer lists follow-through under 'Add only what the task needs'", () => {
  const lines = read("skills/codex-prompting/SKILL.md").split("\n");
  const addOnlyIndex = lines.findIndex((line) => /add only what the task needs/i.test(line));
  assert.notEqual(addOnlyIndex, -1, "SKILL.md should keep the 'Add only what the task needs' list");
  const items = listItemIndexesAfter(lines, addOnlyIndex).map((index) => lines[index]);
  assert.ok(items.length > 0, "the 'Add only what the task needs' list should keep its items");
  assert.deepEqual(
    items.filter((item) => /follow[-_ ]?through|reasonable assumptions|stop\w* to ask/i.test(item)),
    [],
    "follow-through should not be an item of the 'Add only what the task needs' list"
  );
});

test("codex-prompt-recipes intro covers a request with no named test or command", () => {
  const recipes = read("skills/codex-prompting/references/codex-prompt-recipes.md");
  const firstHeading = recipes.search(/^## /m);
  assert.ok(firstHeading > 0, "codex-prompt-recipes.md should have an intro before its first ## heading");
  const intro = recipes.slice(0, firstHeading);

  const noCheckLine = lineMatchingAll(intro, [
    /\b(?:named|gave|gives|names|specified|provided|mentioned)\s+no\b|\bno\s+(?:named\s+|specific\s+)?(?:tests?|checks?|commands?)\b|\b(?:did|does|do)\s*(?:not|n't)\s+(?:name|give|specify|provide|mention)\b|\bwithout\s+(?:a\s+)?(?:named\s+)?(?:test|check|command)\b/i
  ]);
  assert.ok(noCheckLine, "the recipes intro should say what to do when the user named no test or command");
  assert.match(noCheckLine, /\bdone[_ ]when\b/i, "the no-check line should cover the done_when placeholders");
  assert.match(
    noCheckLine,
    /\bobservabl\w*|\bvisible (?:result|behaviou?r|outcome)\b|\bexpected (?:result|behaviou?r|outcome)\b/i,
    "the no-check line should say done_when describes the observable result"
  );
  assert.match(noCheckLine, /\brun_fix_loop\b|\bfix loop\b/i, "the no-check line should cover the run_fix_loop placeholders");
  assert.match(
    noCheckLine,
    /\bCodex\b[^.;]{0,40}?\b(?:choose|chooses|pick|picks|select|selects|decide|decides|determine|determines|identify|identifies|find|finds|work out|works out)\b[^.;]{0,60}?\b(?:checks?|tests?|commands?)\b|\b(?:checks?|tests?|commands?)\b[^.;]{0,40}?\bto Codex\b/i,
    "the no-check line should let Codex choose the checks to run in run_fix_loop"
  );

  // AC4f: the rescue subagent must not look up a command or inspect the repository.
  // Negated clauses and clauses about what Codex does are allowed.
  const lookupClauses = intro
    .split(/[.;:,]\s+|\n/)
    .filter(
      (clause) =>
        /\b(?:look(?:ing)?\s+(?:up|for|in|through|at)|search(?:ing)?|inspect(?:ing)?|grep(?:ping)?|scan(?:ning)?|find(?:ing)?|read(?:ing)?|open(?:ing)?)\b/i.test(clause) &&
        /\b(?:repo(?:sitory)?|codebase|package\.json|Makefile|scripts?|CI|project files)\b/i.test(clause) &&
        !/\b(?:not|never|instead of|rather than)\b|n['’]t\b|\bCodex\b/i.test(clause)
    );
  assert.deepEqual(lookupClauses, [], "the recipes intro must not tell the rescue subagent to look up a command or inspect the repository");
  assert.doesNotMatch(
    intro,
    /\bverify (?:your|the|all) work\b|\bdouble[- ]check\b|\brun (?:all|every)(?: the)? tests?\b|\btest everything\b/i,
    "the recipes intro must not add a generic verify-your-work nudge"
  );
});

// Shared by the SKILL.md and antipatterns resume checks.
const DIRECTION_PATTERN = /\bdirection\b/i;
const MATERIAL_PATTERN = /\b(?:material|substantial|significant|meaningful|fundamental)(?:ly)?\b|\bmajor\b/i;
const CHANGED_PATTERN = /\bchang(?:e|es|ed|ing)\b|\bdifferent\b|\bshift\w*/i;
const FULL_PROMPT_PATTERN = /\b(?:full|whole|entire|complete)\s+(?:\w+\s+)?prompt\b|\bin full\b/i;
const RESTATE_PATTERN = /\b(?:restat|re-?send|repeat)\w*|\b(?:full|whole|entire|complete)\s+(?:\w+\s+)?prompt\b|\bin full\b/i;
// Wordings that invert the exception: restating for an unchanged direction, or
// sending only the delta when the direction changed.
const INVERTED_EXCEPTION_PATTERNS = [
  /\beven (?:if|when|though)\b/i,
  /\botherwise\b[^;.]*(?:\b(?:restat|re-?send|repeat)\w*|\b(?:full|whole|entire|complete)\s+(?:\w+\s+)?prompt\b|\bin full\b)/i,
  /\bonly (?:the delta|what changed)\b(?:(?!restat|re-?send|repeat|\bfull\b|\bwhole\b|\bentire\b)[^;.])*?\b(?:if|when)\b[^;.,]*\bdirection\b(?![^;.,]*\b(?:not|unchanged|hasn['’]t|didn['’]t)\b)/i,
  /\b(?:restat|re-?send|repeat)\w*\b[^;.]*\bunless\b[^;.,]*\bdirection\b/i
];
const ROUTING_FLAG_PATTERN = /--fresh\b|--resume(?!-last)\b/;

// The exception hangs off the delta-only rule ("only the delta ... unless the direction ..."),
// or the direction change and the restatement share one clause.
function tiesExceptionToRestatement(line) {
  return (
    /\bonly (?:the delta|what changed)\b[^;.]*\bunless\b[^;.,]*\bdirection\b/i.test(line) ||
    line.split(/[;.]/).some((clause) => DIRECTION_PATTERN.test(clause) && RESTATE_PATTERN.test(clause))
  );
}

test("codex-prompting SKILL.md resume line restores the direction-changed exception", () => {
  const skill = read("skills/codex-prompting/SKILL.md");
  const resumeLine = lineMatchingAll(skill, [/`task --resume-last`/, /follow[- ]?up/i, /only the delta/i]);
  assert.ok(resumeLine, "SKILL.md should keep one line on `task --resume-last` follow-ups sending only the delta");
  assert.match(resumeLine, DIRECTION_PATTERN, "the resume line should make an exception when the direction changed");
  assert.match(resumeLine, MATERIAL_PATTERN, "the resume line exception should be limited to a material change");
  assert.match(resumeLine, CHANGED_PATTERN, "the resume line exception should be about the direction having changed");
  assert.match(resumeLine, FULL_PROMPT_PATTERN, "the resume line should say to restate the full prompt in that case");
  assert.ok(
    tiesExceptionToRestatement(resumeLine),
    "the resume line should tie the direction change to restating the full prompt (\"only the delta ... unless the direction ...\")"
  );
  for (const pattern of INVERTED_EXCEPTION_PATTERNS) {
    assert.doesNotMatch(resumeLine, pattern, "the resume line should not invert the exception");
  }
  assert.doesNotMatch(resumeLine, /\bfresh\b/i, "routing (fresh runs) belongs to the agent, not the resume line");
  assert.doesNotMatch(skill, ROUTING_FLAG_PATTERN, "SKILL.md should not give --fresh or --resume routing advice");
});

test("codex-prompt-antipatterns resume section carries the same direction-changed exception", () => {
  const section = markdownSection(
    read("skills/codex-prompting/references/codex-prompt-antipatterns.md"),
    /^## .*(?:\brestat\w*|\bresum\w*|\bfollow[- ]?ups?\b)/i
  );
  assert.match(section, /`task --resume-last`/, "the antipatterns resume section should keep naming `task --resume-last`");
  assert.match(section, /\bonly (?:what changed|the delta|the change)/i, "the antipatterns resume section should keep sending only the delta");
  assert.match(section, FULL_PROMPT_PATTERN, "the antipatterns resume section should keep naming the full prompt");
  const exceptionLine = lineMatchingAll(section, [DIRECTION_PATTERN, MATERIAL_PATTERN, CHANGED_PATTERN]);
  assert.ok(
    exceptionLine,
    "the antipatterns resume section should carve out a materially changed direction, as SKILL.md does"
  );
  assert.ok(
    tiesExceptionToRestatement(exceptionLine),
    "the antipatterns exception should tie the direction change to restating the full prompt"
  );
  for (const pattern of INVERTED_EXCEPTION_PATTERNS) {
    assert.doesNotMatch(exceptionLine, pattern, "the antipatterns exception should not be inverted");
  }
  assert.doesNotMatch(
    exceptionLine,
    /^\s*(?:\*\*)?Bad\b(?![^\n]*\b(?:not|unchanged|hasn['’]t|didn['’]t)\b)/i,
    "a Bad: line that names the direction should only call restating bad when the direction has not changed"
  );
  assert.doesNotMatch(section, ROUTING_FLAG_PATTERN, "the antipatterns resume section should not give --fresh or --resume routing advice");
  assert.doesNotMatch(section, /\bfresh\b/i, "routing (fresh runs) belongs to the agent, not the antipatterns");
});

// A verb that grants or implies edits. Negated uses ("do not change files",
// "without editing") are removed before matching.
const EDIT_VERB =
  "(?:edit(?:s|ed|ing)?|modif(?:y|ies|ied|ying)|writ(?:e|es|ing|ten)|chang(?:e|es|ed|ing)|fix(?:es|ed|ing)?|patch(?:es|ed|ing)?|appl(?:y|ies|ied|ying)|delet(?:e|es|ed|ing)|creat(?:e|es|ed|ing)|alter(?:s|ed|ing)?)\\b";
const NEGATED_EDIT_PATTERN = new RegExp(
  `(?:\\b(?:not|never|without|no)|n['’]t)\\s+(?:\\w+\\s+){0,2}?${EDIT_VERB}(?:\\s*,?\\s*(?:\\w+\\s+){0,2}?${EDIT_VERB})*`,
  "gi"
);
const EDIT_VERB_PATTERN = new RegExp(`\\b${EDIT_VERB}`, "gi");

function editGrants(text) {
  return text.replace(NEGATED_EDIT_PATTERN, " ").match(EDIT_VERB_PATTERN) ?? [];
}

test("Diagnosis recipe follow_through may run the failing test without granting edits", () => {
  const diagnosis = markdownSection(
    read("skills/codex-prompting/references/codex-prompt-recipes.md"),
    /^## Diagnosis\s*$/
  );
  const followThrough = xmlBlock(diagnosis, "follow_through");
  assert.match(followThrough, /reasonable assumptions/i, "Diagnosis follow_through should keep the reasonable-assumptions line");
  assert.match(followThrough, /\bread(?:ing)?\b[^.;\n]*\bfiles?\b/i, "Diagnosis follow_through should still grant reading files");
  assert.ok(
    lineMatchingAll(followThrough, [
      /\b(?:may|can|are (?:free|allowed|permitted) to)\b[^.;\n]*?\brun\w*\b[^.;\n]*?(?:\bfailing (?:tests?|commands?|checks?)\b|\brepro\w*|\breproduc\w*)/i,
      /\bwithout (?:asking|approval|permission)\b/i
    ]),
    "Diagnosis follow_through should give permission (may/can) to run the failing test or repro command without asking"
  );
  assert.deepEqual(editGrants(followThrough), [], "Diagnosis follow_through must not grant or imply edits");
});

test("prompt-blocks follow_through read-only guidance agrees with the Diagnosis recipe", () => {
  const lines = read("skills/codex-prompting/references/prompt-blocks.md").split("\n");
  const start = lines.findIndex((line) => /^### `follow_through`/.test(line));
  assert.notEqual(start, -1, "prompt-blocks.md should keep the follow_through block");
  const end = lines.findIndex((line, index) => index > start && /^#{2,3} /.test(line));
  const description = lines
    .slice(start, end === -1 ? lines.length : end)
    .join("\n")
    .replace(/```[\s\S]*?```/g, "");
  const readOnlyLine = lineMatchingAll(description, [/\bread-only\b|without `--write`/i]);
  assert.ok(readOnlyLine, "prompt-blocks follow_through should keep its guidance for a read-only run");
  assert.match(
    readOnlyLine,
    /\bfailing (?:tests?|commands?|checks?)\b|\brepro\w*|\breproduc\w*|(?:\b(?:not|never|without)|n['’]t)\s+(?:\w+\s+){0,2}?(?:chang|modif|edit|writ)\w*\s+(?:any\s+)?files\b/i,
    "the read-only guidance should allow running the failing test or commands that do not change files, as the Diagnosis recipe does"
  );
});

test("recipes other than Diagnosis keep their follow_through text", () => {
  const recipes = read("skills/codex-prompting/references/codex-prompt-recipes.md");
  const assumptions = "Make reasonable assumptions where details are missing, state them,";
  const writeGrant = [
    "You may edit files in this repository and run local builds and tests without asking.",
    "Stop only before an action that is clearly destructive or irreversible."
  ];
  const readOnlyGrant = "You may read files and run read-only commands without asking.";
  const expected = {
    "Narrow Fix": [`${assumptions} and carry the fix through to done.`, ...writeGrant],
    Implementation: [`${assumptions} and carry the work through to done.`, ...writeGrant],
    Review: [`${assumptions} and keep going until done.`, readOnlyGrant],
    "Research Or Recommendation": [`${assumptions} and keep going until done.`, readOnlyGrant],
    "Prompt-Patching": [`${assumptions} and keep going until done.`]
  };
  for (const [heading, text] of Object.entries(expected)) {
    assert.equal(
      xmlBlock(markdownSection(recipes, new RegExp(`^## ${heading}\\s*$`)), "follow_through"),
      text.join("\n"),
      `${heading} follow_through should stay as it is`
    );
  }
});

test("hooks keep session-end cleanup and stop gating enabled", () => {
  const source = read("hooks/hooks.json");
  assert.match(source, /SessionStart/);
  assert.match(source, /SessionEnd/);
  assert.match(source, /stop-review-gate-hook\.mjs/);
  assert.match(source, /session-lifecycle-hook\.mjs/);
});

test("setup command can offer Codex install and still points users to codex login", () => {
  const setup = read("commands/setup.md");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  assert.match(setup, /argument-hint:\s*'\[--enable-review-gate\|--disable-review-gate\]'/);
  assert.match(setup, /AskUserQuestion/);
  assert.match(setup, /npm install -g @openai\/codex/);
  assert.match(setup, /codex-companion\.mjs" setup --json \$ARGUMENTS/);
  assert.match(readme, /!codex login/);
  assert.match(readme, /offer to install Codex for you/i);
  assert.match(readme, /\/codex:setup --enable-review-gate/);
  assert.match(readme, /\/codex:setup --disable-review-gate/);
});
