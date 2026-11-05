# Codex Prompt Anti-Patterns

Avoid these when writing a Codex `task` prompt. The run is non-interactive and Codex follows instructions closely, so most of these either stall the run or hold Codex back from finishing.
Block names refer to [prompt-blocks.md](prompt-blocks.md).

## Vague goal, no finish line

Bad:

```text
Take a look at this and let me know what you think.
```

Better:

```xml
<goal>
Find why `npm test -- config` fails since the change to `src/config/load.ts`.
</goal>

<done_when>
You can name the root cause and show the evidence behind it.
</done_when>
```

## Ask-first or stop-and-ask language

Bad:

```text
If anything is unclear, stop and ask me before changing code.
```

A question ends the run, and the user gets the question instead of the work.

Better:

```xml
<follow_through>
Make reasonable assumptions where details are missing, state them in your final message, and carry the task through to done.
Stop only before an action that is clearly destructive or irreversible.
</follow_through>
```

## Stop-for-review gate after a first implementation

Bad:

```text
Implement a first version, then stop so I can review it before you continue.
```

This pulls Codex toward an early stopping point. Put the real finish line in `done_when`. If the user only wants a plan or a first step, make that the goal itself.

Better:

```xml
<done_when>
The importer handles the three sample files and `npm test -- importer` passes.
</done_when>
```

## Generic "test everything and double-check" nudges

Bad:

```text
Make sure to run all the tests and double-check your work before finishing.
```

Generic nudges lead to broader testing than the change needs. Name the checks that matter instead.

Better:

```xml
<done_when>
`npm test -- config` passes and loading a config without `retries` yields 3.
</done_when>
```

For a small, reversible change, add `testing_scope`.

## Mandatory broad reading before any change

Bad:

```text
Before making any change, read the whole repository and every file in docs/.
```

Codex works out what it needs to read. Pass on the pointers the user gave and say when each one applies.

Better:

```xml
<context>
`docs/schema.md` describes the table layout; use it if the fix touches the schema.
</context>
```

## Over-specified procedures and piled-on rules

Bad:

```text
ALWAYS read the file first. NEVER change more than 10 lines. You MUST explain every step before taking it, then list three alternatives, then ...
```

Rules the task does not need constrain Codex where its own judgment would do better, and emphatic wording makes them more likely to be taken too seriously.

Better: state the goal, the limits the user actually set, and the finish line, and leave the steps to Codex.

```xml
<constraints>
Keep the change inside `src/config/`.
</constraints>
```

## Unsolicited approval flows and safety checklists

Bad:

```text
Before each edit, list the risks and wait for confirmation.
```

Better:

```xml
<follow_through>
You may edit files in this repository and run local builds and tests without asking.
Do not add warnings, disclaimers, or approval steps the task did not ask for.
</follow_through>
```

## Telling Codex to ignore AGENTS.md

Bad:

```text
Ignore AGENTS.md and any skills; follow only this prompt.
```

Better: keep the repository's AGENTS.md in force, and use `instruction_priority` to settle conflicts with skill guidance and make any pause visible.

## Restating the whole prompt on a follow-up

Bad: re-sending the full original prompt with `task --resume-last`.

Better: send only what changed, for example "Apply the fix you proposed for `loadEnvConfig` too."

If the direction changed materially, restate the full prompt instead.

## Asking for more reasoning instead of a clearer request

Bad:

```text
Think harder and be very smart about this.
```

Better: sharpen `goal` and `done_when` so Codex knows exactly what finished looks like.

## Adding jobs the user did not ask for

Bad: turning "fix the config loader" into

```text
Fix the config loader, update the docs, clean up the tests, and suggest a roadmap.
```

Better: send the job the user asked for. If the request itself holds several jobs, give each its own line in `done_when` so Codex knows when all of them are finished.

## Unsupported certainty

Bad:

```text
Tell me exactly why production failed.
```

Better:

```xml
<grounding_rules>
Back each finding with the log line, file, or command output it rests on.
Label inferences as inferences.
</grounding_rules>
```
