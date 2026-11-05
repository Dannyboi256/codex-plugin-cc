# Prompt Blocks

Blocks for Codex `task` prompts. Wrap each block in the XML tag shown in its heading.
Most prompts need `goal`, `context`, `done_when`, and `follow_through`, plus `constraints` when the user set limits; add any other block only when the task calls for it.
Each example shows the kind of text that goes inside the tag. Write a few lines for the task at hand instead of pasting the example whole.

## Core

### `goal`

The change, fix, answer, or decision the user wants.

```xml
<goal>
Make `parseConfig` accept an empty `retries` field and fall back to the default of 3.
</goal>
```

### `context`

What the user already gave you: file paths, error output, failing commands, earlier findings. Pass it on as given. Codex explores the repository and reads its AGENTS.md itself, so do not restate repository conventions or go looking for more.

```xml
<context>
`npm test -- config` fails with "TypeError: retries is undefined" since the user's change to `src/config/load.ts`.
</context>
```

### `constraints`

Limits the user set for this task. Leave this block out when there are none.

```xml
<constraints>
Keep the change inside `src/config/`. Do not change the public `loadConfig` signature.
</constraints>
```

### `done_when`

What must be true for the task to be finished. Name the specific checks that matter for this change.

```xml
<done_when>
`npm test -- config` passes and loading a config file without `retries` yields 3.
</done_when>
```

## Follow-through

### `follow_through`

The run is non-interactive, so a question ends it with the work unfinished. Use this block in any prompt where Codex might otherwise stop to ask. For a read-only run, grant reading files and running commands that do not change files, such as the failing test, instead of edits.

```xml
<follow_through>
Make reasonable assumptions where details are missing, state them in your final message, and carry the task through to done.
You may read and edit files in this repository and run local builds and tests without asking.
Stop only before an action that is clearly destructive or irreversible, and say what you stopped before.
Do not add warnings, disclaimers, or approval steps the task did not ask for.
</follow_through>
```

### `run_fix_loop`

Use when the task includes getting the implementation working.

```xml
<run_fix_loop>
After the change, run `npm test -- config`, inspect the result, fix failures caused by the change, and rerun until it passes.
</run_fix_loop>
```

### `exploration_scope`

Use when you want Codex to go beyond a first pass. Say what to explore and where to stop.

```xml
<exploration_scope>
After the root cause, check whether `loadEnvConfig` has the same gap.
Stop there, and list anything else you noticed without investigating it.
</exploration_scope>
```

## Optional

### `safe_loop_permission`

Use only when the user has said a loop is safe, for example local tests with disposable fixtures.

```xml
<safe_loop_permission>
The local tests use disposable fixtures and have no production access.
Run them, fix failures caused by the requested change, and rerun affected tests without asking for approval at each step.
</safe_loop_permission>
```

### `testing_scope`

Use when the change is small and should get checks to match, not a broad test pass.

```xml
<testing_scope>
Do not write tests for reversible, low-impact changes that mirror the implementation.
Run the checks named in done_when; broaden or repeat testing only when new changes, failures, or unresolved concerns justify it.
</testing_scope>
```

### `grounding_rules`

Use for diagnosis, review, and research, where unsupported claims would mislead.

```xml
<grounding_rules>
Back each finding with the file and line, command output, or source it rests on.
Label inferences as inferences.
</grounding_rules>
```

### `output_contract`

Use when the shape of the final message matters. The user sees only that message.

```xml
<output_contract>
Return the root cause, the evidence for it, and the fix you made or recommend.
</output_contract>
```

For a reader who wants prose rather than headings and lists, ask for it:

```xml
<output_contract>
Answer in short, plain paragraphs with the main point first.
Use a list only when the items are genuinely parallel or sequential.
</output_contract>
```

### `instruction_priority`

Use when the user wants explicit task instructions to win over conflicting skill guidance, or wants to know why Codex paused or diverged. It settles conflicts with skill guidance and makes pauses visible; it does not set aside the repository's AGENTS.md.

```xml
<instruction_priority>
Explicit instructions in this task take precedence over conflicting guidance in a skill.
If a skill or AGENTS.md instruction makes you pause, ask for confirmation, leave requested work unfinished, or diverge from this task, name the file, quote the instruction, and say how it applied.
Separate explicit requirements from your own reading of general guidance.
</instruction_priority>
```

### `delegation`

Opt-in only: add it when the user asks for parallel or delegated work, never by default.

```xml
<delegation>
You may hand bounded, independent parts of this task to sub-agents in parallel, for example one per module under investigation.
Check what each sub-agent returns against the code before you rely on it or report it.
</delegation>
```
