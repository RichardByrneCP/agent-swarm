import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { commitAll } from './git.js';

const SWARM_DIR = '.swarm';
const DECISIONS_REL = path.join(SWARM_DIR, 'design', 'decisions.md');
const GUIDE_REL = path.join(SWARM_DIR, 'field-guide', 'index.md');

/**
 * Write the shared context (design decisions + an empty field guide) into the
 * integration worktree and commit it. This is injected into every worker.
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
  await commitAll('swarm: initialize shared context (design decisions + field guide)', integrationWorktree);
}

/** Read the current shared context for injection into a worker/reviewer prompt. */
export async function readSharedContext(integrationWorktree) {
  const decisions = await safeRead(path.join(integrationWorktree, DECISIONS_REL));
  const fieldGuide = await safeRead(path.join(integrationWorktree, GUIDE_REL));
  return { decisions, fieldGuide };
}

/**
 * Append worker-authored notes to the field guide, enforcing a line budget by
 * keeping the most recent notes. Commits the change.
 */
export async function appendFieldGuideNotes(integrationWorktree, leafId, notes, lineBudget) {
  const cleaned = notes
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith('-') ? l : `- ${l}`));
  if (cleaned.length === 0) return;

  const file = path.join(integrationWorktree, GUIDE_REL);
  const current = (await safeRead(file)) || '# Field guide\n\n## Notes\n';
  const entry = `\n### ${leafId}\n${cleaned.join('\n')}\n`;
  let next = current + entry;

  // Enforce the line budget on the Notes section by trimming oldest entries.
  next = trimToBudget(next, lineBudget);

  await writeFileEnsured(file, next);
  await commitAll(`swarm: field guide notes from ${leafId}`, integrationWorktree);
}

function trimToBudget(content, lineBudget) {
  const marker = '## Notes\n';
  const idx = content.indexOf(marker);
  if (idx === -1) return content;
  const head = content.slice(0, idx + marker.length);
  const bodyLines = content.slice(idx + marker.length).split('\n');
  if (bodyLines.length <= lineBudget) return content;
  const trimmed = bodyLines.slice(bodyLines.length - lineBudget);
  return head + trimmed.join('\n');
}

async function writeFileEnsured(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}

async function safeRead(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}
