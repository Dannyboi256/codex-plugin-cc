---
name: codex-prompting
description: Internal guidance for tightening a rescue request into one Codex `task` prompt. Use inside `codex:codex-rescue` before the single `task` call.
user-invocable: false
---

# Codex Prompting

Use this skill inside `codex:codex-rescue` to turn the user's request into the prompt for one Codex `task` run. It shapes prompt text only: Codex does the reading, editing, and checking.

How a rescue run works:
- Every rescue request becomes one `task` run, whether the work is diagnosis, planning, research, or implementation.
- The run is non-interactive. Codex runs with approval policy "never" in a read-only sandbox, or workspace-write when `--write` is set, and the user sees only Codex's final message. A question from Codex ends the run, so the user gets the question instead of the work.
- For a follow-up on the same Codex thread (`task --resume-last`), send only the delta instruction unless the direction changed materially, in which case restate the full prompt; the thread already holds the earlier prompt and work.
- Reviewing local git changes belongs to the built-in `review` and `adversarial-review` commands, which carry their own review contract; rescue runs do not call them.

Write the prompt in four parts:
- Goal: the change, fix, answer, or decision the user wants, in their terms.
- Context: what the user already gave you, such as file paths, error output, failing commands, and earlier findings. Pass it on as given and do not go looking for more; Codex explores the repository itself and reads the repository's AGENTS.md.
- Constraints: the limits the user set for this task, if any, such as scope, files to leave alone, or compatibility. Don't invent general rules.
- Done when: what must be true for the task to be finished, such as the named test passing, the bug no longer reproducing, or the question answered with evidence. Name the specific checks that matter for this change instead of a general "verify your work".

Nearly every prompt also needs follow-through: tell Codex to make reasonable assumptions, state them, and finish the task rather than stop to ask. Say what it may do without approval, and reserve stopping for clearly destructive or irreversible actions.

Add only what the task needs:
- If the task includes getting the implementation working, make the run, inspect, and fix loop part of the request.
- If you want exploration beyond a first pass, say what to explore and where to stop.
- Known-safe loops, testing scope, grounding, output shape, instruction priority, and delegation are optional blocks; add them only when the request calls for them. Delegation is opt-in: add it only when the user asks for parallel work.

Keep the user's intent and wording; tighten the request rather than expanding it. Each extra rule is something Codex may follow too literally, so leave out guidance the task does not need.

References:
- [references/prompt-blocks.md](references/prompt-blocks.md): the four core blocks, the follow-through blocks, and the optional blocks.
- [references/codex-prompt-recipes.md](references/codex-prompt-recipes.md): starting templates for diagnosis, fixes, implementation, review, research, and prompt revision.
- [references/codex-prompt-antipatterns.md](references/codex-prompt-antipatterns.md): prompt habits that stall or over-constrain a non-interactive run.
