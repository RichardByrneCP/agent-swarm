# agent-swarm

A local **planner/worker agent swarm** built on the [Cursor SDK](https://cursor.com/docs/sdk/typescript), inspired by Cursor's [Agent swarms and the new model economics](https://cursor.com/blog/agent-swarm-model-economics).

A frontier **planner** (Opus, auto-detected) recursively decomposes a goal into a task tree. Fast **workers** (Composer) execute each leaf in isolated git worktrees. A **reviewer** lens checks each change, and a neutral **reconciler** resolves any merge conflicts. Most tokens are spent by cheap workers; the expensive planner is used only where frontier judgment is needed.

This folder is self-contained and portable. It installs as a global `agent-swarm` command and runs against whatever git repo you invoke it from.

## How it maps to the article

| Article concept | Here |
| --- | --- |
| Planner agents (smartest model) split a goal recursively | Opus, at the root and per `subtree` node down to a depth cap |
| Worker agents (fast, cheap) execute leaves | Composer, one per leaf, in its own worktree |
| Planner never implements, worker never plans | Separate prompts/roles; planners are read-only |
| Split-brain / planner contention | Planners run one-at-a-time; each owns its subtree's design decisions and a disjoint `fileScope` |
| Merge conflicts resolved by a neutral third party | `reconciler` agent, invoked only on real conflicts |
| Review lenses | `reviewer` agent over each worker's diff (one bounce-back) |
| Field Guide (self-authored shared context) | `.swarm/field-guide/index.md`, injected into every worker, line-budgeted |
| Version control at swarm scale | git worktrees + one integration branch per run |

## Install

Requires **Node >= 22.13** and git.

### macOS / Linux

From the tool directory:

```bash
./install.sh
```

### Windows

Native PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Or, if you work in **WSL2** or **Git Bash**, use the macOS/Linux `./install.sh` instead (recommended if you're unsure - the local runtime is best-tested on a Unix shell).

Both installers check your Node version, install dependencies, link the global `agent-swarm` command, and install the personal skill into `~/.cursor/skills/agent-swarm/` (`%USERPROFILE%\.cursor\skills\agent-swarm\` on Windows).

Then set your API key (get one at [Cursor Dashboard -> Integrations](https://cursor.com/dashboard/integrations)):

```bash
cp .env.example .env   # then add your CURSOR_API_KEY   (or set the CURSOR_API_KEY env var)
```

On Windows PowerShell: `Copy-Item .env.example .env` then edit it, or `setx CURSOR_API_KEY "..."`.

## Usage

Run from inside the git repo you want the swarm to work on:

```bash
# Plan only - see the task tree and wave schedule, do no work
agent-swarm "Add request rate limiting to the public API" --dry-run

# Full run (a real run spawns paid agents and requires --yes)
agent-swarm "Add request rate limiting to the public API" --yes

# Larger task: deeper tree, more workers
agent-swarm "Build a CSV import pipeline with validation and tests" \
  --max-depth 3 --max-leaves 150 --concurrency 6 --yes

# Re-execute a previously saved plan without re-planning
agent-swarm --from-plan .swarm-runs/run-XXXX/plan.json --yes
```

### Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--max-depth <n>` | 2 | Planner recursion depth cap (use 3 for large tasks). Safety cap. |
| `--max-leaves <n>` | 40 | Total worker tasks cap. Primary size guardrail. |
| `--concurrency <n>` | 4 | Parallel workers per wave. |
| `--base <ref>` | current HEAD | Git ref to branch from. |
| `--planner-model <id>` | auto (latest Opus) | Override planner model. |
| `--worker-model <id>` | `composer-2.5` | Override worker model. |
| `--no-review` | off | Skip the review stage. |
| `--dry-run` | off | Plan only. |
| `--yes` | off | Confirm a real (paid) run without an interactive prompt. Required in non-interactive contexts. |
| `--from-plan <file>` | - | Execute a saved `plan.json`. |
| `--keep-worktrees` | off | Keep per-leaf worktrees/branches. |
| `--version` | - | Print version and exit. |

Model roles and defaults can also be set in `.env` (see `.env.example`).

## What a run produces

- A per-run integration branch `swarm/<runId>/integration` containing all merged work. Nothing is merged into your working branch automatically.
- Artifacts under `.swarm-runs/<runId>/` (`plan.json`).
- Transient worktrees under `.swarm-worktrees/<runId>/` (removed after the run).

Inspect and apply:

```bash
git diff <base>...swarm/<runId>/integration     # review
git merge swarm/<runId>/integration             # apply, when you're happy
```

## How it works

```
goal
  -> planner (Opus)         recursive decomposition into a task tree (depth/leaf capped)
  -> scheduler              flatten to leaves, topo-sort deps into waves
  -> per wave:
       worktree per leaf    isolated checkout from the integration branch
       worker (Composer)    implements one leaf within its fileScope
       reviewer             pass / fail (+ one retry)
       merge -> integration sequential; reconciler agent on conflict
       field guide          worker notes folded into shared context
  -> integration branch     left for you to review and merge
```

## Guardrails and cost

- **Depth** (`--max-depth`) caps recursion; leaves grow ~`b^depth`, so treat it as a safety limit.
- **Leaves** (`--max-leaves`) caps total worker count regardless of branching. When either cap is hit, remaining subtrees are executed as-is.
- A cost/usage summary by role is printed at the end. The planner is a small fraction of tokens but typically the majority of cost; workers are the reverse.

## Team onboarding

To share with teammates or other teams:

1. Give them this folder (clone the repo, or copy it) into a central location, e.g. `~/.cursor/agent-swarm`.
2. They run `./install.sh` (macOS/Linux/WSL/Git Bash) or `install.ps1` (native Windows PowerShell): checks Node, installs deps, links the `agent-swarm` command, installs the personal skill.
3. They set their own `CURSOR_API_KEY` (never commit `.env`; it is gitignored). For CI, use a team service-account key.
4. They can now run `agent-swarm ...` from any repo, or just ask Cursor to "run an agent swarm to ...".

Notes for wider use:

- **Model access:** the planner auto-detects the latest Opus. If a teammate lacks Opus access, they set `PLANNER_MODEL` to a model they can use. Workers default to `composer-2.5`.
- **Cost:** every worker is a paid agent. Real runs require `--yes`, and the skill always does a `--dry-run` first. Use `--max-leaves` to cap fan-out.
- **Updates:** `agent-swarm --version` reports the installed version. Re-run `./install.sh` after pulling changes.

## Notes / assumptions

- Requires **Node >= 22.13** (a `@cursor/sdk` requirement) and git.
- Cross-platform (macOS, Linux, Windows). The code uses no shell or POSIX-only paths; only the installers differ per OS. The SDK local runtime is best-tested on Unix shells, so on Windows prefer WSL2 if you hit anything unexpected.
- Runs locally against your machine's environment. Agents use inline config only (`settingSources: []`), so project/user rules are not loaded by default.
- Workers are told to stay within their `fileScope`; an essential out-of-scope change must be minimal and marked with a `SWARM-BREAKING:` comment (mirrors the article's "licensed breakage").
- The `.swarm/` directory (design decisions + field guide) lives only on the run's integration branch.
