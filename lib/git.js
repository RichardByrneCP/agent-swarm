import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run a git command against a repo. Throws with stderr on failure.
 * @param {string[]} args git arguments
 * @param {object} [opts]
 * @param {string} [opts.cwd] working directory (defaults to process.cwd())
 * @param {boolean} [opts.allowFail] resolve instead of throwing on non-zero exit
 * @returns {Promise<{ stdout: string, stderr: string, code: number|string }>}
 */
export async function git(args, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
  } catch (err) {
    const stdout = (err.stdout || '').toString().trim();
    const stderr = (err.stderr || '').toString().trim() || (err.message || '').trim();
    const code = err.code ?? 1;
    if (opts.allowFail) {
      return { stdout, stderr, code };
    }
    const detail = (stderr || stdout || err.message || '').trim();
    const errCode = typeof code === 'string' ? ` [${code}]` : '';
    throw new Error(`git ${args.join(' ')} failed${errCode}: ${detail}`);
  }
}

/** Resolve the top-level directory of the git repo containing `cwd`. */
export async function repoRoot(cwd = process.cwd()) {
  const { stdout } = await git(['rev-parse', '--show-toplevel'], { cwd });
  // Normalize so Windows callers combining with path.join use a consistent form.
  return path.resolve(stdout);
}

/** Current branch name, or null when detached. */
export async function currentBranch(cwd) {
  const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  return stdout === 'HEAD' ? null : stdout;
}

/** Resolve a ref to a full commit sha. */
export async function revParse(ref, cwd) {
  const { stdout } = await git(['rev-parse', ref], { cwd });
  return stdout;
}

/** True when the working tree at `cwd` has staged or unstaged changes. */
export async function hasChanges(cwd) {
  const { stdout } = await git(['status', '--porcelain'], { cwd });
  return stdout.length > 0;
}

/**
 * Stage project files and commit. Excludes common transient/agent artifact
 * paths so arbitrary target repos are less likely to absorb node_modules or
 * swarm run directories. Returns false when there was nothing to commit.
 *
 * Set SWARM_NO_VERIFY=1 to pass --no-verify (bypasses target-repo hooks).
 */
export async function commitAll(message, cwd) {
  await git(
    [
      'add',
      '-A',
      '--',
      '.',
      ':(exclude)node_modules',
      ':(exclude)node_modules/**',
      ':(exclude).swarm-worktrees',
      ':(exclude).swarm-worktrees/**',
      ':(exclude).swarm-runs',
      ':(exclude).swarm-runs/**',
    ],
    { cwd },
  );
  const staged = await git(['diff', '--cached', '--name-only', '-z'], { cwd });
  if (!staged.stdout) return false;
  const commitArgs = ['commit', '-m', message];
  if (process.env.SWARM_NO_VERIFY === '1' || process.env.SWARM_NO_VERIFY === 'true') {
    commitArgs.splice(1, 0, '--no-verify');
  }
  await git(commitArgs, { cwd });
  return true;
}
