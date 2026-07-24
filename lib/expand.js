import { planRoot, planSubtree } from './planner.js';
import { log } from './log.js';

/**
 * Build a fully-expanded task tree from a goal.
 *
 * The root planner produces the top level; every "subtree" node is expanded by
 * a scoped sub-planner, recursing until all nodes are leaves or a guardrail
 * (maxDepth / maxLeaves) stops expansion. Planners run one-at-a-time down the
 * tree so they never contend over shared state.
 *
 * @param {string} goal
 * @param {object} ctx { cwd, model, apiKey, maxDepth, maxLeaves, repoSummary }
 * @returns {Promise<{ tree: object[], decisions: string[], plannerUsages: any[], leafCount: number }>}
 */
export async function expandTree(goal, ctx) {
  const state = { leaves: 0, decisions: [], plannerUsages: [] };

  const root = await planRoot(goal, {
    cwd: ctx.cwd,
    model: ctx.model,
    apiKey: ctx.apiKey,
    repoSummary: ctx.repoSummary,
    remainingDepth: ctx.maxDepth,
    leavesRemaining: ctx.maxLeaves,
  });
  state.decisions.push(...root.level.designDecisions);
  state.plannerUsages.push(root.usage);

  const tree = [];
  for (const raw of root.level.nodes) {
    tree.push(
      await expandNode(raw, {
        prefix: '',
        depth: 1,
        ancestorDecisions: [...root.level.designDecisions],
        ctx,
        state,
      }),
    );
  }

  return {
    tree,
    decisions: state.decisions,
    plannerUsages: state.plannerUsages,
    leafCount: state.leaves,
  };
}

async function expandNode(raw, { prefix, depth, ancestorDecisions, ctx, state }) {
  const globalId = prefix ? `${prefix}/${raw.id}` : raw.id;
  const node = {
    id: globalId,
    localId: raw.id,
    title: raw.title,
    type: raw.type,
    spec: raw.spec,
    fileScope: raw.fileScope,
    dependsOn: raw.dependsOn.map((d) => (prefix ? `${prefix}/${d}` : d)),
    depth,
  };

  if (raw.type === 'leaf') {
    state.leaves += 1;
    return node;
  }

  // Subtree: expand unless a guardrail says stop.
  const depthOk = depth < ctx.maxDepth;
  const leavesOk = state.leaves < ctx.maxLeaves;
  if (!depthOk || !leavesOk) {
    const reason = !depthOk ? `max-depth ${ctx.maxDepth}` : `max-leaves ${ctx.maxLeaves}`;
    log.warn(`Coercing subtree "${globalId}" to a leaf (${reason} reached).`);
    node.type = 'leaf';
    node.coerced = true;
    state.leaves += 1;
    return node;
  }

  const sub = await planSubtree(node, {
    cwd: ctx.cwd,
    model: ctx.model,
    apiKey: ctx.apiKey,
    remainingDepth: ctx.maxDepth - depth,
    leavesRemaining: Math.max(1, ctx.maxLeaves - state.leaves),
    ancestorDecisions,
  });
  state.decisions.push(...sub.level.designDecisions);
  state.plannerUsages.push(sub.usage);

  const childAncestors = [...ancestorDecisions, ...sub.level.designDecisions];
  node.children = [];
  for (const childRaw of sub.level.nodes) {
    node.children.push(
      await expandNode(childRaw, {
        prefix: globalId,
        depth: depth + 1,
        ancestorDecisions: childAncestors,
        ctx,
        state,
      }),
    );
  }
  return node;
}

/** Pretty-print the expanded tree for the CLI. */
export function renderTree(tree, indent = '') {
  const lines = [];
  for (const node of tree) {
    const tag = node.type === 'leaf' ? log.color.green('leaf') : log.color.magenta('subtree');
    const deps = node.dependsOn.length ? log.color.dim(` depends:[${node.dependsOn.join(', ')}]`) : '';
    const coerced = node.coerced ? log.color.yellow(' (coerced)') : '';
    lines.push(`${indent}${log.color.bold(node.id)} ${tag}${coerced} ${log.color.dim('- ' + node.title)}${deps}`);
    if (node.children?.length) lines.push(renderTree(node.children, indent + '  '));
  }
  return lines.join('\n');
}
