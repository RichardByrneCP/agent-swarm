---
name: agent-swarm
description: Run the agent-swarm CLI (Opus planner + Composer workers) to decompose and implement a large goal via the Cursor SDK. Use when the user asks to run a swarm, use the agent swarm, decompose a task with planner/worker agents, or run agent-swarm on a goal.
---

# Agent Swarm

Front door to the globally-installed `agent-swarm` command: a frontier planner (Opus) recursively decomposes a goal into a task tree; fast Composer workers implement each leaf in isolated git worktrees, with review and merge-reconciliation.

## Resolve the command

Use `agent-swarm` if it is on PATH. If not found, fall back to `"$AGENT_SWARM_HOME/index.js"` (default `~/.cursor/agent-swarm/index.js`) invoked with `node`. If neither exists, tell the user to run the tool's `install.sh`.

## Preflight (check once per run)

1. Node >= 22.13 (`node -v`). If lower, stop and tell the user to upgrade (e.g. `nvm use 22`).
2. `CURSOR_API_KEY` set (env or the tool's `.env`). If missing, point to `.env.example`.
3. Run from inside the git repo the swarm should work on. It creates a separate `swarm/<runId>/integration` branch and never merges into the current branch automatically.

## Workflow

Copy this checklist and track progress:

```
- [ ] Preflight passed (Node >= 22.13, API key set, inside target repo)
- [ ] Confirmed goal and flags with the user
- [ ] Dry run: reviewed task tree + wave schedule
- [ ] Confirmed cost/scope, then full run with --yes
- [ ] Reported integration branch + how to review/merge
```

**Step 1 - Dry run first (no paid work, safe).**

```bash
agent-swarm "<goal>" --dry-run
```

Show the user the task tree, the leaf/wave counts, and the saved `plan.json` path.

**Step 2 - Confirm, then run for real.** A real run spawns many paid agents and requires `--yes`. Only add `--yes` after the user explicitly confirms.

```bash
agent-swarm "<goal>" [flags] --yes
```

**Step 3 - Report the result.** Surface the integration branch and the review/apply commands the CLI prints. Never run the apply merge automatically:

```bash
git diff <base>...swarm/<runId>/integration    # review
git merge swarm/<runId>/integration            # apply, only when the user approves
```

## Choosing flags

- Default depth/leaves (`--max-depth 2`, `--max-leaves 40`) suit most tasks.
- Large/long tasks: `--max-depth 3 --max-leaves 150 --concurrency 6`.
- `--no-review` to skip the review lens; `--planner-model` / `--worker-model` to override models.
- Re-run a saved plan: `agent-swarm --from-plan .swarm-runs/<runId>/plan.json --yes`.

Run `agent-swarm --help` for the full flag reference.

## Notes

- Do not paste large scripts to run the swarm; always invoke the `agent-swarm` command.
- If a teammate lacks Opus access, set `PLANNER_MODEL` to a model they can use.
