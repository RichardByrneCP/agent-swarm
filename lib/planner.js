import { runAgent } from './agent.js';
import { extractJson } from './json.js';
import { validatePlannerLevel } from './schema.js';
import { log } from './log.js';

const JSON_SHAPE = `{
  "designDecisions": [
    "Short, concrete decisions YOU are making so children never re-decide them.",
    "e.g. 'Use a single Result<T,E> error type across all modules.'"
  ],
  "nodes": [
    {
      "id": "kebab-case-id",
      "title": "Short human title",
      "type": "leaf | subtree",
      "spec": "Precise, self-contained instructions. For a leaf: exactly what to build and the acceptance criteria. For a subtree: the sub-goal a sub-planner must decompose.",
      "fileScope": ["relative/path/or/dir", "another/glob/**"],
      "dependsOn": ["sibling-id-that-must-finish-first"]
    }
  ]
}`;

const RULES = (opts) => `You are a PLANNER agent in a planner/worker swarm. You DECOMPOSE work; you never implement it.

Follow these rules strictly:
1. Split the goal into a small set of children (aim for 3-7). Each child is either:
   - "leaf": small enough that ONE worker can complete it in a single focused session (roughly one cohesive module/feature). Leaves are handed to fast worker agents.
   - "subtree": still too big; it will be handed to another planner to split further.
2. Make all shared DESIGN DECISIONS yourself and record them in "designDecisions". Children must not re-decide these. This prevents two branches from implementing the same concept differently (split-brain).
3. Assign every child a "fileScope" (files/dirs it owns). Sibling scopes MUST be disjoint${
  opts.parentScope ? ` and stay within the parent scope [${opts.parentScope.join(', ')}]` : ''
}. Two children must never edit the same file.
4. Use "dependsOn" only to reference sibling ids that must complete first. Keep the dependency graph acyclic. Prefer independent children so they can run in parallel.
5. Depth budget: ${opts.remainingDepth} planning level(s) remain (including this one). ${
  opts.remainingDepth <= 1
    ? 'You are at the DEEPEST level: every child MUST be a "leaf".'
    : 'Only use "subtree" when a piece genuinely needs further decomposition.'
}
6. Leaf budget: about ${opts.leavesRemaining} more leaf tasks can be created across the whole tree. Do not over-split.
7. You MAY read files in the repository to ground your plan, but you MUST NOT modify any files. Your only output is the plan JSON.

Output ONLY the plan as JSON between <PLAN_JSON> and </PLAN_JSON> markers, matching this shape:

<PLAN_JSON>
${JSON_SHAPE}
</PLAN_JSON>`;

/**
 * Run the root planner on the overall goal.
 * @returns {Promise<{ level: object, usage: any }>}
 */
export async function planRoot(goal, ctx) {
  const prompt = `${RULES({
    parentScope: null,
    remainingDepth: ctx.remainingDepth,
    leavesRemaining: ctx.leavesRemaining,
  })}

## GOAL
${goal}
${ctx.repoSummary ? `\n## REPOSITORY CONTEXT\n${ctx.repoSummary}\n` : ''}
Produce the top-level decomposition now.`;

  return invokePlanner(prompt, ctx, {});
}

/**
 * Run a sub-planner scoped to a single subtree node.
 * @returns {Promise<{ level: object, usage: any }>}
 */
export async function planSubtree(node, ctx) {
  const ancestors = ctx.ancestorDecisions?.length
    ? ctx.ancestorDecisions.map((d) => `- ${d}`).join('\n')
    : '(none yet)';

  const prompt = `${RULES({
    parentScope: node.fileScope,
    remainingDepth: ctx.remainingDepth,
    leavesRemaining: ctx.leavesRemaining,
  })}

## PARENT SUB-GOAL (decompose this)
${node.spec}

## YOUR FILE SCOPE (children must stay within this)
${node.fileScope.map((s) => `- ${s}`).join('\n')}

## DESIGN DECISIONS ALREADY MADE BY ANCESTORS (do not contradict; do not re-decide)
${ancestors}

Produce the decomposition of this sub-goal now.`;

  return invokePlanner(prompt, ctx, { parentScope: node.fileScope, parentId: node.id });
}

async function invokePlanner(prompt, ctx, validateCtx) {
  const label = validateCtx.parentId ? `sub-planner(${validateCtx.parentId})` : 'root';
  log.planner(`planning: ${label}`);

  const res = await runAgent({
    prompt,
    model: ctx.model,
    cwd: ctx.cwd,
    apiKey: ctx.apiKey,
    role: 'planner',
  });

  if (res.startupError) {
    throw new Error(`Planner failed to start: ${res.error}`);
  }
  if (!res.ok) {
    throw new Error(`Planner run did not finish cleanly (${res.status}): ${res.error || ''}`);
  }

  let parsed;
  try {
    parsed = extractJson(res.text);
  } catch (err) {
    throw new Error(`Planner (${label}) did not return valid JSON: ${err.message}`);
  }

  const level = validatePlannerLevel(parsed, validateCtx);
  log.planner(
    `${label} -> ${level.nodes.length} node(s): ` +
      level.nodes.map((n) => `${n.id}[${n.type}]`).join(', '),
  );
  return { level, usage: res.usage };
}
