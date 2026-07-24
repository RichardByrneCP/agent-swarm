import { git } from './git.js';

/**
 * Thin wrappers around `git worktree` so each planner/worker gets an isolated
 * checkout. All operations target the primary repo at `repo`.
 */

/** Create a worktree on a new branch at `ref`. */
export async function addWorktree(repo, path, branch, ref) {
  await git(['worktree', 'add', '-b', branch, path, ref], { cwd: repo });
}

/** Create a detached worktree at `ref` (used for read-only planning). */
export async function addDetachedWorktree(repo, path, ref) {
  await git(['worktree', 'add', '--detach', path, ref], { cwd: repo });
}

/** Remove a worktree (force discards uncommitted changes inside it). */
export async function removeWorktree(repo, path, { force = true } = {}) {
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(path);
  const res = await git(args, { cwd: repo, allowFail: true });
  if (res.code !== 0) {
    // Fall back to pruning stale metadata if the dir was already gone.
    await git(['worktree', 'prune'], { cwd: repo, allowFail: true });
  }
}

/** Delete a branch (used to clean up per-leaf branches after a run). */
export async function deleteBranch(repo, branch) {
  await git(['branch', '-D', branch], { cwd: repo, allowFail: true });
}

/**
 * Merge `branch` into the branch checked out at `integrationWorktree`.
 * @returns {Promise<{ ok: boolean, conflict: boolean, message: string }>}
 */
export async function mergeBranch(integrationWorktree, branch, message) {
  const res = await git(
    ['merge', '--no-ff', '-m', message, branch],
    { cwd: integrationWorktree, allowFail: true },
  );
  if (res.code === 0) return { ok: true, conflict: false, message: res.stdout };

  const status = await git(['diff', '--name-only', '--diff-filter=U'], {
    cwd: integrationWorktree,
    allowFail: true,
  });
  const conflict = status.stdout.length > 0;
  return { ok: false, conflict, message: res.stderr || res.stdout };
}

/** Abort an in-progress merge. */
export async function abortMerge(integrationWorktree) {
  await git(['merge', '--abort'], { cwd: integrationWorktree, allowFail: true });
}

/** List unmerged (conflicted) files in a worktree. */
export async function conflictedFiles(worktree) {
  const res = await git(['diff', '--name-only', '--diff-filter=U'], {
    cwd: worktree,
    allowFail: true,
  });
  return res.stdout ? res.stdout.split('\n').filter(Boolean) : [];
}

/** Diff a worktree branch against a base ref. */
export async function diffAgainst(worktree, baseRef) {
  const res = await git(['diff', `${baseRef}...HEAD`], { cwd: worktree, allowFail: true });
  return res.stdout;
}
