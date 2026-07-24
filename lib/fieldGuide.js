import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { commitAll } from './git.js';
import { log } from './log.js';

const SWARM_DIR = '.swarm';
const DECISIONS_REL = path.join(SWARM_DIR, 'design', 'decisions.md');
const GUIDE_REL = path.join(SWARM_DIR, 'field-guide', 'index.md');

/**
 * Write the shared context (design decisions + an empty field guide) into the
 * integration worktree and commit it. This is injected into every worker.
 *
 * Note: `.swarm/` is intentionally committed on the integration branch so
 * workers can read shared state from the target checkout. Merging that branch
 * into the user's mainline brings `.swarm/` unless excluded at merge time.
 */
export async function initSharedContext(integrationWorktree, goal, decisions) {
  const decisionsMd =
    `# Design decisions\n\nShared decisions made by planners. Workers MUST follow these and must not re-decide them.\n\n` +
    `## Goal\n${goal}\n\n## Decisions\n` +
    (decisions.length ? decisions.map((d) => `- ${d}`).join('\n') : '- (none recorded)') +
    '\n';

  const guideMd =
    `# Field guide\n\nSelf-authored shared notes. Capture surprises, gotchas, and conventions ` +
    `so the next worker's path is shorter. Keep it terse.\n\n## Notes\n`;

  await writeFileEnsured(path.join(integrationWorktree, DECISIONS_REL), decisionsMd);
  await writeFileEnsured(path.join(integrationWorktree, GUIDE_REL), guideMd);
  const committed = await commitAll(
    'swarm: initialize shared context (design decisions + field guide)',
    integrationWorktree,
  );
  if (!committed) {
    throw new Error(
      'Failed to commit shared context under .swarm/. ' +
        'Ensure .swarm/ is not gitignored in the target repository.',
    );
  }
}

/** Read the current shared context for injection into a worker/reviewer prompt. */
export async function readSharedContext(integrationWorktree) {
  const decisions = await readRequired(path.join(integrationWorktree, DECISIONS_REL), 'design decisions');
  const fieldGuide = await readRequired(path.join(integrationWorktree, GUIDE_REL), 'field guide');
  return { decisions, fieldGuide };
}

/**
 * Append worker-authored notes to the field guide, enforcing a line budget by
 * dropping the oldest whole entries (### blocks). Commits the change.
 */
export async function appendFieldGuideNotes(integrationWorktree, leafId, notes, lineBudget) {
  const cleaned = notes
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith('-') ? l : `- ${l}`));
  if (cleaned.length === 0) return;

  const file = path.join(integrationWorktree, GUIDE_REL);
  const current = await readExistingOrDefault(file);
  const entry = `\n### ${leafId}\n${cleaned.join('\n')}\n`;
  const next = trimToBudget(current + entry, lineBudget);

  await writeFileEnsured(file, next);
  const committed = await commitAll(`swarm: field guide notes from ${leafId}`, integrationWorktree);
  if (!committed) {
    throw new Error(
      `Failed to commit field guide notes from ${leafId}. ` +
        'Ensure .swarm/ is not gitignored in the target repository.',
    );
  }
}

function trimToBudget(content, lineBudget) {
  const normalized = content.replace(/\r\n/g, '\n');
  const re = /^## Notes[ \t]*\n/m;
  const match = re.exec(normalized);
  if (!match) {
    log.warn('Field guide missing "## Notes" section; skipping budget trim.');
    return content;
  }
  const head = normalized.slice(0, match.index + match[0].length);
  const body = normalized.slice(match.index + match[0].length);
  let entries = splitEntries(body);
  while (countNonBlankLines(entries) > lineBudget && entries.length > 1) {
    entries = entries.slice(1);
  }
  return head + entries.join('');
}

function splitEntries(body) {
  if (!body.trim()) return [];
  const parts = body.split(/\n(?=### )/);
  return parts.filter((p) => p.trim() !== '');
}

function countNonBlankLines(entries) {
  return entries
    .join('')
    .split('\n')
    .filter((l) => l.trim() !== '').length;
}

async function writeFileEnsured(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}

async function readRequired(file, label) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read ${label} at ${file}: ${err.message}`);
  }
}

async function readExistingOrDefault(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return '# Field guide\n\n## Notes\n';
    }
    throw new Error(`Failed to read field guide at ${file}: ${err.message}`);
  }
}
