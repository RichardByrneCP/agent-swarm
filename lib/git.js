import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run a git command against a repo. Throws with stderr on failure.
 * @param {string[]} args git arguments
 * @param {object} [opts]
 * @param {string} [opts.cwd] working directory (defaults to process.cwd())
 * @param {boolean} [opts.allowFail] resolve instead of throwing on non-zero exit
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
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
    if (opts.allowFail) {
      return {
        stdout: (err.stdout || '').trim(),
        stderr: (err.stderr || '').trim(),
        code: typeof err.code === 'number' ? err.code : 1,
      };
    }
    const detail = (err.stderr || err.stdout || err.message || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

/** Resolve the top-level directory of the git repo containing `cwd`. */
export async function repoRoot(cwd = process.cwd()) {
  const { stdout } = await git(['rev-parse', '--show-toplevel'], { cwd });
  return stdout;
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

/** Stage everything and commit. Returns false when there was nothing to commit. */
export async function commitAll(message, cwd) {
  await git(['add', '-A'], { cwd });
  const staged = await git(['diff', '--cached', '--name-only'], { cwd });
  if (!staged.stdout) return false;
  await git(['commit', '--no-verify', '-m', message], { cwd });
  return true;
}
