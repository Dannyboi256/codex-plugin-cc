# Codex Prompt Recipes

Use these as starting templates for Codex task prompts.
Copy the closest recipe, replace each [bracketed placeholder] with what the user gave you, and drop any block the task does not need. Block meanings are in [prompt-blocks.md](prompt-blocks.md).
If the user named no test or command, describe the observable result in `done_when` and, in `run_fix_loop`, let Codex choose and run the relevant checks instead of inventing a command.
Diagnosis, Review, Research Or Recommendation, and Prompt-Patching do not ask Codex to edit files. Narrow Fix and Implementation need a write-capable run, which the rescue agent sets with `--write` unless the user asked for read-only work.

## Diagnosis

```xml
<goal>
Find why [failing test, command, or behavior] fails.
</goal>

<context>
[error output, paths, and recent changes the user gave]
</context>

<done_when>
You can name the root cause and show the code and evidence behind it, or you have narrowed it to the remaining candidates and what separates them.
</done_when>

<follow_through>
Make reasonable assumptions where details are missing, state them, and keep going until done.
You may read files and run the failing test or repro command, and other local commands that do not change files, without asking.
</follow_through>

<grounding_rules>
Back each finding with the file and line or command output it rests on. Label inferences as inferences.
</grounding_rules>

<output_contract>
Return the root cause, the evidence, and the smallest fix you would make.
</output_contract>
```

## Narrow Fix

```xml
<goal>
Fix [the bug] so that [expected behavior].
</goal>

<context>
[error output, repro steps, and paths the user gave]
</context>

<constraints>
Keep the change to the failing path. No unrelated refactors.
</constraints>

<done_when>
[named test] passes and [repro command] no longer shows the error.
</done_when>

<run_fix_loop>
Run [named test], fix failures caused by your change, and rerun until it passes.
</run_fix_loop>

<follow_through>
Make reasonable assumptions where details are missing, state them, and carry the fix through to done.
You may edit files in this repository and run local builds and tests without asking.
Stop only before an action that is clearly destructive or irreversible.
</follow_through>

<output_contract>
Return what you changed, the files touched, the checks you ran with their results, and anything left open.
</output_contract>
```

For a small, reversible fix, add `testing_scope` so Codex runs the named checks instead of a broad test pass.

## Implementation

```xml
<goal>
Add [feature or change] so that [observable result].
</goal>

<context>
[spec, examples, paths, and earlier findings the user gave]
</context>

<constraints>
[limits the user set, such as files to leave alone or APIs to keep]
</constraints>

<done_when>
[observable result holds], [named tests] pass, and [build or lint command] exits cleanly.
</done_when>

<run_fix_loop>
Build and run [named tests], inspect the results, fix failures caused by the change, and rerun until done_when holds.
</run_fix_loop>

<follow_through>
Make reasonable assumptions where details are missing, state them, and carry the work through to done.
You may edit files in this repository and run local builds and tests without asking.
Stop only before an action that is clearly destructive or irreversible.
</follow_through>

<output_contract>
Return what you built, the files touched, the checks you ran with their results, and any assumptions or open items.
</output_contract>
```

Add `safe_loop_permission` only when the user has said the test loop is safe, `exploration_scope` when the user wants related areas covered, and `delegation` only when the user asked for parallel work.

## Review

Use when the user asks for a review of specific code, a design, or a plan. Reviews of local git changes have their own commands.

```xml
<goal>
Review [code, design, or plan] for correctness and regression risks that matter for [purpose].
</goal>

<context>
[paths, documents, or concerns the user gave]
</context>

<done_when>
Every finding has its evidence, and the areas the user named are covered.
</done_when>

<exploration_scope>
After the first issues, also check [areas the user named, such as error paths, retries, or stale state].
Stop when those are covered.
</exploration_scope>

<follow_through>
Make reasonable assumptions where details are missing, state them, and keep going until done.
You may read files and run read-only commands without asking.
</follow_through>

<grounding_rules>
Back each finding with the file and line it rests on. Label inferences as inferences.
</grounding_rules>

<output_contract>
Return findings ordered by severity, each with its evidence and a suggested next step.
</output_contract>
```

## Research Or Recommendation

```xml
<goal>
Recommend [the best option] for [decision the user faces].
</goal>

<context>
[options, requirements, and sources the user gave]
</context>

<done_when>
You can recommend one option and say what evidence would change that recommendation.
</done_when>

<exploration_scope>
Compare [the named options] on [criteria]. Go deeper only where the evidence would change the recommendation, then stop.
</exploration_scope>

<follow_through>
Make reasonable assumptions where details are missing, state them, and keep going until done.
You may read files and run read-only commands without asking.
</follow_through>

<grounding_rules>
Separate observed facts from inferences, and cite the files or sources you relied on. Prefer primary sources.
</grounding_rules>

<output_contract>
Answer in short, plain paragraphs: the recommendation first, then the tradeoffs and any open questions.
</output_contract>
```

## Prompt-Patching

```xml
<goal>
Find why [the existing prompt] underperforms and propose the smallest changes that fix it.
</goal>

<context>
[the prompt text and the failure examples the user gave]
</context>

<done_when>
Each failure example is traced to something in the prompt, and the revised prompt addresses it without adding conflicting instructions.
</done_when>

<follow_through>
Make reasonable assumptions where details are missing, state them, and keep going until done.
</follow_through>

<grounding_rules>
Base the diagnosis on the prompt text and the failure examples. Do not invent failure modes they do not show.
</grounding_rules>

<output_contract>
Return the failure modes, their causes in the prompt, a revised prompt, and why the revision should work better.
</output_contract>
```
