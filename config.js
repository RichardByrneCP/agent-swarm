import 'dotenv/config';

const intEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

/**
 * Base configuration, sourced from environment / .env. CLI flags layer on top
 * of this in index.js. Kept dependency-free so the folder is portable: drop it
 * into any git repo and run against that repo's working directory.
 */
export const config = {
  apiKey: process.env.CURSOR_API_KEY || '',

  // Model roles. plannerModel is resolved at runtime when left empty.
  plannerModel: process.env.PLANNER_MODEL || '',
  workerModel: process.env.WORKER_MODEL || 'composer-2.5',
  reviewerModel: process.env.REVIEWER_MODEL || 'composer-2.5',
  reconcilerModel: process.env.RECONCILER_MODEL || 'composer-2.5',

  // Recursion guardrails. maxDepth is a safety cap; maxLeaves is the primary
  // size guardrail (a shallow-but-wide tree can still fan out hugely).
  maxDepth: intEnv('SWARM_MAX_DEPTH', 2),
  maxLeaves: intEnv('SWARM_MAX_LEAVES', 40),

  // Worker fan-out.
  concurrency: intEnv('SWARM_CONCURRENCY', 4),

  // Field guide (self-authored shared context) line budget.
  fieldGuideLineBudget: intEnv('SWARM_FIELD_GUIDE_LINES', 200),

  // Where transient worktrees and run artifacts live, relative to the target repo.
  worktreeRoot: process.env.SWARM_WORKTREE_ROOT || '.swarm-worktrees',
  runRoot: process.env.SWARM_RUN_ROOT || '.swarm-runs',

  // Stages that can be toggled off from the CLI.
  reviewEnabled: true,
};
