import { access } from 'node:fs/promises';
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

/**
 * Remove a worktree. Defaults to a non-force remove so uncommitted work is not
 * silently discarded; pass `{ force: true }` to escalate after a failed gentle
 * remove (or when the caller knows the checkout is disposable).
 */
export async function removeWorktree(repo, worktreePath, { force = false } = {}) {
  let res = await git(['worktree', 'remove', worktreePath], { cwd: repo, allowFail: true });
  if (res.code !== 0 && force) {
    res = await git(['worktree', 'remove', '--force', worktreePath], {
      cwd: repo,
      allowFail: true,
    });
  }
  if (res.code === 0) return;

  let exists = true;
  try {
    await access(worktreePath);
  } catch {
    exists = false;
  }

  if (!exists) {
    // Directory already gone — prune stale worktree metadata.
    await git(['worktree', 'prune'], { cwd: repo, allowFail: true });
    return;
  }

  const detail = res.stderr || res.stdout || String(res.code);
  throw new Error(`Failed to remove worktree ${worktreePath}: ${detail}`);
}

/**
 * Delete a branch after a successful merge. Uses `-d` (safe) so unmerged
 * branches are not force-destroyed.
 */
export async function deleteBranch(repo, branch) {
  const res = await git(['branch', '-d', branch], { cwd: repo, allowFail: true });
  if (res.code !== 0) {
    throw new Error(`Failed to delete branch ${branch}: ${res.stderr || res.stdout || res.code}`);
  }
}

/**
 * Merge `branch` into the branch checked out at `integrationWorktree`.
 * Aborts an in-progress merge when the failure is not a content conflict so
 * later merges in the same run are not blocked.
 * @returns {Promise<{ ok: boolean, conflict: boolean, message: string }>}
 */
export async function mergeBranch(integrationWorktree, branch, message) {
  const res = await git(['merge', '--no-ff', '-m', message, branch], {
    cwd: integrationWorktree,
    allowFail: true,
  });
  if (res.code === 0) return { ok: true, conflict: false, message: res.stdout };

  const conflicted = await conflictedFiles(integrationWorktree);
  const conflict = conflicted.length > 0;
  const messageText = res.stderr || res.stdout;

  if (!conflict) {
    // Non-conflict failure (or misclassified): clear MERGE_HEAD so later merges work.
    const mergeInProgress = await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
      cwd: integrationWorktree,
      allowFail: true,
    });
    if (mergeInProgress.code === 0) {
      await abortMerge(integrationWorktree);
    }
  }

  return { ok: false, conflict, message: messageText };
}

/** Abort an in-progress merge. */
export async function abortMerge(integrationWorktree) {
  await git(['merge', '--abort'], { cwd: integrationWorktree, allowFail: true });
}

/** List unmerged (conflicted) files in a worktree (NUL-safe paths). */
export async function conflictedFiles(worktree) {
  const res = await git(['diff', '-z', '--name-only', '--diff-filter=U'], {
    cwd: worktree,
    allowFail: true,
  });
  if (!res.stdout) return [];
  return res.stdout.split('\0').map((p) => p.trim()).filter(Boolean);
}

/** Diff a worktree branch against a base ref. Throws when git fails. */
export async function diffAgainst(worktree, baseRef) {
  const res = await git(['diff', `${baseRef}...HEAD`], { cwd: worktree, allowFail: true });
  if (res.code !== 0) {
    const detail = res.stderr || res.stdout || String(res.code);
    throw new Error(`git diff ${baseRef}...HEAD failed: ${detail}`);
  }
  return res.stdout;
}
