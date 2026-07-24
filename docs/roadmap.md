# Agent-swarm roadmap & usage notes

Ideas to address later, plus guidance on when this tool is (and is not) a good fit.

## When to use agent-swarm

### Best fit

Use the swarm when the goal is **large enough to decompose** and **parallelizable across disjoint file scopes**:

- Multi-module features (API + persistence + UI + tests)
- Broad refactors that touch many independent areas
- Codebase audits (bugs, security, docs drift) with one report/fix area per leaf
- Migrations (split by package, route, or bounded context)
- “Build X end-to-end” where a planner can assign clear ownership boundaries

Sweet spot: roughly **a day or more of senior-engineer work**, or anything you’d naturally split across 3+ PRs / workstreams.

### Good but narrower fit

- Medium tasks with clear seams (e.g. “add rate limiting + metrics + docs”) if you keep `--max-leaves` low
- Re-running a saved `--from-plan` after editing the plan by hand

### Poor fit (prefer a single agent / normal Cursor chat)

- One-file or one-function changes
- Exploratory “how does this work?” questions
- Tightly coupled edits that cannot have disjoint `fileScope`s (high merge/reconcile cost)
- Urgent hotfix where setup + planning latency dominates
- Anything where you need continuous human steering every few minutes

### Efficiency rule of thumb

It is **not** efficient for every task. Overhead includes:

- Planner (frontier model) tokens and latency
- Per-leaf worker + optional reviewer runs
- Git worktree / merge machinery

That overhead pays off when **parallel workers save wall-clock time** or **decomposition quality** beats a single long agent session. For small work, one Composer/Opus chat is cheaper and faster.

| Signal | Prefer swarm | Prefer single agent |
| --- | --- | --- |
| Independent file areas | Yes | No |
| Leaf count likely ≥ ~5 | Yes | No |
| Heavy shared mutable state | No | Yes |
| Need answer in < ~5 minutes | No | Yes |
| Want reviewable integration branch | Yes | Optional |

Always start with `--dry-run`. Abort if the tree is one giant leaf or scopes heavily overlap.

---

## Future improvements

### Highest leverage

1. **Live progress** — ~~Stream worker/reviewer heartbeats (last tool/file touch) so long runs don’t look stuck.~~ **Done** (`feat/live-progress`: `Agent.create` + `run.stream`, idle heartbeats; `SWARM_PROGRESS=0` to disable).
2. **Resume / checkpoint** — Persist wave state; restart from the last successful leaf after failure.
3. **Plan edit gate** — After dry-run, make editing `plan.json` (or a small TUI) the default path before `--yes`.

### Creative workflows to productize

- **Audit → fix pipeline** — First-class `--mode audit` then `--mode fix` (per-area branches/PRs), matching the manual bug-audit workflow.
- **Issue → PR** — `--from-issue <url>` (GitHub/Linear): goal from ticket, finish with a draft PR from the integration branch.
- **Adversarial pair** — Swarm A implements; Swarm B only reviews/attacks (security, refactors).
- **Self-swarm** — Periodic run against this repo (audit + small fix PR) to keep the CLI honest.

### Integrations

- **GitHub** — Auto-draft PR + summary comment (tree, waves, token usage).
- **Cursor Automations / hooks** — Scheduled triage or maintenance swarms.
- **CI smoke tests** — Fast Node checks for `parseArgs`, `safeName`, `buildSchedule`, `extractJson` (pure-function regressions from the audit).

### Explicitly defer

- Fancy dashboards / multi-cloud orchestration
- Rewriting the planner core (Opus plans + Composer executes + worktrees is the right shape)

### Suggested order

1. ~~Resume + live progress~~ → live progress shipped; resume/checkpoint next
2. Productize audit → fix
3. GitHub draft-PR integration
4. CI smoke tests for parsing/scheduling helpers 
