import { runAgent } from './agent.js';
import { commitAll } from './git.js';
import { conflictedFiles, abortMerge } from './worktrees.js';

/**
 * Resolve merge conflicts in the integration worktree with a neutral third-party
 * agent, mirroring the article's impartial merge resolver. Runs after a failed
 * `git merge` has left conflict markers in the working tree.
 *
 * @returns {Promise<{ ok: boolean, usage: any, error?: string }>}
 */
export async function runReconciler({ integrationWorktree, branch, model, apiKey, shared }) {
  const files = await conflictedFiles(integrationWorktree);
  if (files.length === 0) {
    // Nothing to resolve; treat as success.
    return { ok: true, usage: null };
  }

  const prompt = `You are a neutral MERGE RECONCILER. A merge of "${branch}" left conflicts in this repository. Resolve every conflict impartially and efficiently, preserving the intent of BOTH sides where possible. Do not favor either side arbitrarily and do not delete work to make conflicts disappear.

## CONFLICTED FILES
${files.map((f) => `- ${f}`).join('\n')}

## SHARED DESIGN DECISIONS (use these to break ties)
${shared.decisions || '(none)'}

Instructions:
- Edit each conflicted file to a correct, coherent final state.
- Remove ALL conflict markers (<<<<<<<, =======, >>>>>>>).
- Do not introduce unrelated changes.
Do not run git commands; just edit the files to their resolved state.`;

  const res = await runAgent({ prompt, model, cwd: integrationWorktree, apiKey, role: 'reconciler' });
  if (!res.ok) {
    await abortMerge(integrationWorktree);
    return { ok: false, usage: res.usage, error: res.error || res.status };
  }

  const remaining = await conflictedFiles(integrationWorktree);
  const stillMarked = remaining.length > 0;
  if (stillMarked) {
    await abortMerge(integrationWorktree);
    return { ok: false, usage: res.usage, error: `unresolved conflicts remain in: ${remaining.join(', ')}` };
  }

  await commitAll(`swarm: reconcile merge conflicts from ${branch}`, integrationWorktree);
  return { ok: true, usage: res.usage };
}
