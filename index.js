#!/usr/bin/env node
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import pLimit from 'p-limit';

import { config } from './config.js';
import { resolvePlannerModel, verifyModel } from './models.js';
import { log } from './lib/log.js';
import { git, repoRoot, currentBranch, revParse, commitAll } from './lib/git.js';
import { expandTree, renderTree } from './lib/expand.js';
import { buildSchedule } from './lib/scheduler.js';
import {
  addWorktree,
  addDetachedWorktree,
  removeWorktree,
  deleteBranch,
  mergeBranch,
  diffAgainst,
} from './lib/worktrees.js';
import { initSharedContext, readSharedContext, appendFieldGuideNotes } from './lib/fieldGuide.js';
import { runWorker } from './lib/worker.js';
import { runReviewer } from './lib/reviewer.js';
import { runReconciler } from './lib/reconciler.js';
import { createCostTracker } from './lib/cost.js';

const HELP = `agent-swarm - local planner/worker agent swarm (Cursor SDK)

Usage:
  node index.js "<goal>" [options]

Options:
  --max-depth <n>        Max planner recursion depth (default ${config.maxDepth}; 3 for large tasks)
  --max-leaves <n>       Max total leaf/worker tasks (default ${config.maxLeaves})
  --concurrency <n>      Parallel workers per wave (default ${config.concurrency})
  --base <ref>           Base git ref to branch from (default: current HEAD)
  --planner-model <id>   Override the planner model (default: auto-detect latest Opus)
  --worker-model <id>    Override the worker model (default ${config.workerModel})
  --no-review            Skip the review stage
  --dry-run              Plan only: print the task tree + wave schedule, do no work
  --yes                  Confirm a real (paid) run without an interactive prompt
  --from-plan <file>     Skip planning; load a previously saved plan.json and execute
  --keep-worktrees       Do not delete per-leaf worktrees/branches after the run
  --version              Print version and exit
  -h, --help             Show this help

Environment:
  CURSOR_API_KEY (required)   see .env.example

The tool operates on the git repository containing the current directory.`;

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.version) {
    console.log(await getVersion());
    return;
  }

  const settings = mergeSettings(config, args);
  if (!settings.apiKey) {
    throw new Error('CURSOR_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  if (!args.fromPlan && !args.goal) {
    throw new Error('Provide a goal, e.g. node index.js "Add a rate limiter to the API". See --help.');
  }

  const repo = await repoRoot(process.cwd());
  const baseRef = args.base || (await currentBranch(repo)) || (await revParse('HEAD', repo));
  const baseSha = await revParse(baseRef, repo);
  const runId = `run-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;

  log.heading(`agent-swarm v${await getVersion()} - ${runId}`);
  log.info(`repo:        ${repo}`);
  log.info(`base ref:    ${baseRef} (${baseSha.slice(0, 10)})`);
  log.info(`depth<=${settings.maxDepth}  leaves<=${settings.maxLeaves}  concurrency=${settings.concurrency}  review=${settings.reviewEnabled}`);

  const runDir = path.join(repo, settings.runRoot, runId);
  const worktreeBase = path.join(repo, settings.worktreeRoot, runId);
  await mkdir(runDir, { recursive: true });
  await mkdir(worktreeBase, { recursive: true });

  const cost = createCostTracker();

  // ---- Planning phase (or load a saved plan) ----
  let goal;
  let tree;
  let decisions;

  if (args.fromPlan) {
    const saved = JSON.parse(await readFile(args.fromPlan, 'utf8'));
    goal = saved.goal;
    tree = saved.tree;
    decisions = saved.decisions || [];
    log.step(`Loaded plan from ${args.fromPlan}`);
  } else {
    goal = args.goal;
    const plannerModel = await resolvePlannerModel(settings.apiKey, settings.plannerModel);
    await verifyModel(settings.apiKey, settings.workerModel);
    settings.plannerModel = plannerModel;

    const planningWorktree = path.join(worktreeBase, 'planning');
    await addDetachedWorktree(repo, planningWorktree, baseSha);
    try {
      const repoSummary = await topLevelSummary(repo, baseSha);
      const expanded = await expandTree(goal, {
        cwd: planningWorktree,
        model: plannerModel,
        apiKey: settings.apiKey,
        maxDepth: settings.maxDepth,
        maxLeaves: settings.maxLeaves,
        repoSummary,
      });
      tree = expanded.tree;
      decisions = expanded.decisions;
      for (const u of expanded.plannerUsages) cost.add(u);
    } finally {
      await removeWorktree(repo, planningWorktree, { force: true });
    }

    await writeFile(
      path.join(runDir, 'plan.json'),
      JSON.stringify({ goal, decisions, tree }, null, 2),
      'utf8',
    );
  }

  const schedule = buildSchedule(tree);

  log.heading('Task tree');
  console.log(renderTree(tree));
  log.heading('Schedule');
  log.info(`${schedule.leaves.length} leaf task(s) in ${schedule.waves.length} wave(s)`);
  schedule.waves.forEach((wave, i) => log.info(`  wave ${i + 1}: ${wave.join(', ')}`));

  if (args.dryRun) {
    log.heading('Dry run - no work performed');
    log.info(`Plan saved to ${path.join(runDir, 'plan.json')}`);
    log.info(`Execute this plan with: agent-swarm --from-plan "${path.join(runDir, 'plan.json')}" --yes`);
    cost.print();
    return;
  }

  const proceed = await confirmRealRun({
    leaves: schedule.leaves.length,
    waves: schedule.waves.length,
    yes: args.yes,
  });
  if (!proceed) {
    log.warn('Aborted before execution. Re-run with --yes to proceed, or --dry-run to plan only.');
    return;
  }

  // ---- Execution phase ----
  const integrationBranch = `swarm/${runId}/integration`;
  const integrationWorktree = path.join(worktreeBase, 'integration');
  await addWorktree(repo, integrationWorktree, integrationBranch, baseSha);
  await initSharedContext(integrationWorktree, goal, decisions);

  const results = new Map();
  const leafById = new Map(schedule.leaves.map((l) => [l.id, l]));
  const limit = pLimit(settings.concurrency);

  for (let w = 0; w < schedule.waves.length; w += 1) {
    const wave = schedule.waves[w];
    log.heading(`Wave ${w + 1}/${schedule.waves.length} - ${wave.length} task(s)`);
    const waveBaseSha = await revParse('HEAD', integrationWorktree);
    const shared = await readSharedContext(integrationWorktree);

    // Create isolated worktrees for each leaf in the wave.
    const items = [];
    for (const leafId of wave) {
      const leaf = leafById.get(leafId);
      const safe = safeName(leafId);
      const branch = `swarm/${runId}/${safe}`;
      const worktree = path.join(worktreeBase, safe);
      await addWorktree(repo, worktree, branch, waveBaseSha);
      items.push({ leaf, branch, worktree });
    }

    // Run workers (and review) in parallel within the wave.
    await Promise.all(
      items.map((item) =>
        limit(async () => {
          const r = await executeLeaf({ item, waveBaseSha, shared, settings, cost });
          results.set(item.leaf.id, r);
        }),
      ),
    );

    // Merge passed leaves into integration sequentially (deterministic order).
    for (const item of items) {
      const r = results.get(item.leaf.id);
      if (!r.passed) {
        log.worker(item.leaf.id, log.color.yellow(`skipped merge (${r.reason})`));
        continue;
      }
      await mergeLeaf({ item, integrationWorktree, settings, shared, cost, results });
    }

    // Fold field-guide notes from this wave into shared context.
    for (const item of items) {
      const r = results.get(item.leaf.id);
      if (r.merged && r.notes) {
        await appendFieldGuideNotes(integrationWorktree, item.leaf.id, r.notes, settings.fieldGuideLineBudget);
      }
    }

    // Clean up wave worktrees (branches kept only for failures / --keep-worktrees).
    for (const item of items) {
      const r = results.get(item.leaf.id);
      await removeWorktree(repo, item.worktree, { force: true });
      if (!settings.keepWorktrees && r.merged) await deleteBranch(repo, item.branch);
    }
  }

  await removeWorktree(repo, integrationWorktree, { force: true });

  printSummary({ results, integrationBranch, baseRef, runDir, repo, settings });
  cost.print();
}

async function executeLeaf({ item, waveBaseSha, shared, settings, cost }) {
  const { leaf, worktree } = item;
  log.worker(leaf.id, `working: ${leaf.title}`);

  let work = await runWorker({
    leaf,
    cwd: worktree,
    model: settings.workerModel,
    apiKey: settings.apiKey,
    shared,
  });
  cost.add(work.usage);

  if (!work.ok) {
    return { passed: false, merged: false, reason: `worker ${work.status}: ${work.error || ''}` };
  }

  let committed = await commitAll(`swarm: ${leaf.id} - ${leaf.title}`, worktree);
  if (!committed) {
    return { passed: false, merged: false, reason: 'worker made no changes' };
  }

  if (settings.reviewEnabled) {
    let diff = await diffAgainst(worktree, waveBaseSha);
    let review = await runReviewer({
      leaf,
      diff,
      cwd: worktree,
      model: settings.reviewerModel,
      apiKey: settings.apiKey,
      shared,
    });
    cost.add(review.usage);

    if (!review.pass) {
      log.worker(leaf.id, log.color.yellow(`review failed, retrying: ${firstLine(review.notes)}`));
      work = await runWorker({
        leaf,
        cwd: worktree,
        model: settings.workerModel,
        apiKey: settings.apiKey,
        shared,
        reviewNotes: review.notes,
      });
      cost.add(work.usage);
      await commitAll(`swarm: ${leaf.id} - address review`, worktree);

      diff = await diffAgainst(worktree, waveBaseSha);
      review = await runReviewer({
        leaf,
        diff,
        cwd: worktree,
        model: settings.reviewerModel,
        apiKey: settings.apiKey,
        shared,
      });
      cost.add(review.usage);
      if (!review.pass) {
        log.worker(leaf.id, log.color.yellow('review failed after retry; merging anyway with note'));
      }
    }
  }

  log.worker(leaf.id, log.color.green('done'));
  return { passed: true, merged: false, notes: work.notes };
}

async function mergeLeaf({ item, integrationWorktree, settings, shared, cost, results }) {
  const { leaf, branch } = item;
  const r = results.get(leaf.id);
  const merge = await mergeBranch(integrationWorktree, branch, `swarm: merge ${leaf.id}`);

  if (merge.ok) {
    r.merged = true;
    log.worker(leaf.id, log.color.green('merged'));
    return;
  }

  if (!merge.conflict) {
    r.reason = `merge failed: ${firstLine(merge.message)}`;
    log.worker(leaf.id, log.color.red(r.reason));
    return;
  }

  log.worker(leaf.id, log.color.yellow('merge conflict -> reconciler'));
  const rec = await runReconciler({
    integrationWorktree,
    branch,
    model: settings.reconcilerModel,
    apiKey: settings.apiKey,
    shared,
  });
  cost.add(rec.usage);

  if (rec.ok) {
    r.merged = true;
    log.worker(leaf.id, log.color.green('merged (reconciled)'));
  } else {
    r.merged = false;
    r.reason = `reconcile failed: ${rec.error}`;
    log.worker(leaf.id, log.color.red(r.reason));
  }
}

function printSummary({ results, integrationBranch, baseRef, runDir, repo, settings }) {
  log.heading('Summary');
  let merged = 0;
  let failed = 0;
  for (const [id, r] of results) {
    if (r.merged) {
      merged += 1;
      log.info(`${log.color.green('merged ')} ${id}`);
    } else {
      failed += 1;
      log.info(`${log.color.red('failed ')} ${id} ${log.color.dim('- ' + (r.reason || 'unknown'))}`);
    }
  }
  log.info(`${merged} merged, ${failed} not merged`);

  log.heading('Result');
  log.info(`Integration branch: ${log.color.bold(integrationBranch)}`);
  log.info(`Inspect:   git -C "${repo}" diff ${baseRef}...${integrationBranch}`);
  log.info(`Apply:     git -C "${repo}" merge ${integrationBranch}   ${log.color.dim('(review first; not done automatically)')}`);
  log.info(`Artifacts: ${runDir}`);
  if (settings.keepWorktrees) log.info('Per-leaf worktrees/branches were kept (--keep-worktrees).');
}

async function getVersion() {
  try {
    const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Guard a real (paid) run. Passes immediately with --yes; otherwise prompts on
 * an interactive TTY, and refuses in non-interactive contexts (e.g. invoked by
 * the skill) unless --yes was given.
 */
async function confirmRealRun({ leaves, waves, yes }) {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    log.warn(
      `Non-interactive run of ${leaves} worker task(s) in ${waves} wave(s) requires --yes ` +
        '(each worker is a paid agent).',
    );
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `About to run ${leaves} paid worker task(s) in ${waves} wave(s). Proceed? [y/N] `,
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function topLevelSummary(repo, ref) {
  const res = await git(['ls-tree', '--name-only', ref], { cwd: repo, allowFail: true });
  if (res.code !== 0 || !res.stdout) return '';
  return `Top-level entries: ${res.stdout.split('\n').join(', ')}`;
}

function mergeSettings(base, args) {
  return {
    ...base,
    maxDepth: args.maxDepth ?? base.maxDepth,
    maxLeaves: args.maxLeaves ?? base.maxLeaves,
    concurrency: args.concurrency ?? base.concurrency,
    plannerModel: args.plannerModel ?? base.plannerModel,
    workerModel: args.workerModel ?? base.workerModel,
    reviewEnabled: args.noReview ? false : base.reviewEnabled,
    keepWorktrees: !!args.keepWorktrees,
  };
}

function parseArgs(argv) {
  const out = { goalParts: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    switch (a) {
      case '-h':
      case '--help': out.help = true; break;
      case '--version': out.version = true; break;
      case '--dry-run': out.dryRun = true; break;
      case '--yes': out.yes = true; break;
      case '--no-review': out.noReview = true; break;
      case '--keep-worktrees': out.keepWorktrees = true; break;
      case '--max-depth': out.maxDepth = int(next()); break;
      case '--max-leaves': out.maxLeaves = int(next()); break;
      case '--concurrency': out.concurrency = int(next()); break;
      case '--base': out.base = next(); break;
      case '--planner-model': out.plannerModel = next(); break;
      case '--worker-model': out.workerModel = next(); break;
      case '--from-plan': out.fromPlan = next(); break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
        out.goalParts.push(a);
    }
  }
  out.goal = out.goalParts.join(' ').trim();
  return out;
}

function int(v) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Expected a number, got "${v}"`);
  return n;
}

function safeName(id) {
  return id.replace(/[^a-zA-Z0-9._-]/g, '__');
}

function firstLine(s) {
  return String(s || '').split('\n')[0].slice(0, 160);
}
