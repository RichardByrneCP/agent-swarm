import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runAgent } from './agent.js';
import { git, commitAll } from './git.js';
import { conflictedFiles, abortMerge } from './worktrees.js';

const CONFLICT_MARK_RE = /^<{7}(?: .*)?$|^={7}$|^>{7}(?: .*)?$/m;

/**
 * Resolve merge conflicts in the integration worktree with a neutral third-party
 * agent, mirroring the article's impartial merge resolver. Runs after a failed
 * `git merge` has left conflict markers in the working tree.
 *
 * @returns {Promise<{ ok: boolean, usage: any, error?: string }>}
 */
export async function runReconciler({ integrationWorktree, branch, model, apiKey, shared }) {
  const mergeHead = await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
    cwd: integrationWorktree,
    allowFail: true,
  });
  if (mergeHead.code !== 0) {
    return {
      ok: false,
      usage: null,
      error: 'no merge in progress (MERGE_HEAD missing); cannot reconcile',
    };
  }

  const files = await conflictedFiles(integrationWorktree);
  if (files.length === 0) {
    await abortMerge(integrationWorktree);
    return {
      ok: false,
      usage: null,
      error: 'merge in progress but no unmerged paths listed; aborted',
    };
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

  const res = await runAgent({
    prompt,
    model,
    cwd: integrationWorktree,
    apiKey,
    role: 'reconciler',
    label: `reconcile:${branch.split('/').pop() || branch}`,
  });
  if (!res.ok) {
    await abortMerge(integrationWorktree);
    return { ok: false, usage: res.usage, error: res.error || res.status };
  }

  // Agent is instructed not to run git; stage the conflicted paths ourselves once
  // working-tree content is marker-free (AGENT-015 / AGENT-017).
  const marked = await filesStillContainingMarkers(integrationWorktree, files);
  if (marked.length > 0) {
    await abortMerge(integrationWorktree);
    return {
      ok: false,
      usage: res.usage,
      error: `conflict markers remain in: ${marked.join(', ')}`,
    };
  }

  // Ensure merge is still in progress (agent must not have aborted it).
  const stillMerging = await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
    cwd: integrationWorktree,
    allowFail: true,
  });
  if (stillMerging.code !== 0) {
    return {
      ok: false,
      usage: res.usage,
      error: 'merge was aborted during reconciliation; refusing to commit',
    };
  }

  for (const file of files) {
    await git(['add', '--', file], { cwd: integrationWorktree });
  }

  const remaining = await conflictedFiles(integrationWorktree);
  if (remaining.length > 0) {
    await abortMerge(integrationWorktree);
    return {
      ok: false,
      usage: res.usage,
      error: `unresolved conflicts remain in: ${remaining.join(', ')}`,
    };
  }

  // Prefer staging only the conflicted paths (already added). Fall back to
  // commitAll only if a merge commit still needs creating with no extra paths.
  const staged = await git(['diff', '--cached', '--name-only'], {
    cwd: integrationWorktree,
    allowFail: true,
  });
  if (staged.stdout) {
    await git(['commit', '-m', `swarm: reconcile merge conflicts from ${branch}`], {
      cwd: integrationWorktree,
    });
  } else {
    const committed = await commitAll(
      `swarm: reconcile merge conflicts from ${branch}`,
      integrationWorktree,
    );
    if (!committed) {
      await abortMerge(integrationWorktree);
      return { ok: false, usage: res.usage, error: 'reconcile produced nothing to commit' };
    }
  }

  return { ok: true, usage: res.usage };
}

async function filesStillContainingMarkers(cwd, files) {
  const bad = [];
  for (const file of files) {
    try {
      const body = await readFile(path.join(cwd, file), 'utf8');
      if (CONFLICT_MARK_RE.test(body) || body.includes('<<<<<<<') || body.includes('>>>>>>>')) {
        bad.push(file);
      }
    } catch {
      bad.push(file);
    }
  }
  return bad;
}
